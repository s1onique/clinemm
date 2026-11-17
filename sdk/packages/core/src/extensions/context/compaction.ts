import { join } from "node:path";
import {
	computeCandidateContentFingerprint,
	estimateRequestInputTokens,
} from "@cline/shared";
import {
	CompactionCandidateCaptureStore,
	type CompactionCandidateSnapshot,
	filterCapturableRequestOptions,
	isCompactionCandidateCaptureArmed,
	resolveCompactionCandidateCaptureStorageRoot,
} from "../../runtime/observability/compaction-candidate-capture";
import { resolveModelBehaviorTraceBudget } from "../../runtime/observability/model-behavior-trace";
import { resolveConnectionProviderConfig } from "../../services/llms/handler-factory";
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
	findLatestSummaryIndex,
	MAX_INPUT_UNDERESTIMATE_FACTOR,
	normalizeUserContextCeiling,
	resolveEffectiveMaxInputTokens,
} from "./compaction-shared";
import { applyVerifiedEvidenceToCompactedMessages } from "./evidence-continuity";
import { applyTaskContractToCompactedMessages } from "./task-contract";

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
	/**
	 * Actual provider-reported input tokens for the previous request this run,
	 * used as a floor on the char-based estimate so dense content still triggers
	 * compaction. See AgentPrepareTurnContext.previousRequestInputTokens.
	 */
	previousRequestInputTokens?: number;
	/**
	 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
	 *
	 * The PREPARATION REQUEST IDENTITY — the id the agent runtime minted
	 * ONCE, EARLY, before this compaction seam ran, for the model request
	 * being prepared.
	 *
	 * It is forwarded here so the compaction DECISION can be joined to the
	 * exact request it measured, and that request to the provider dispatch
	 * and the provider-reported usage. Before this, the decision seam
	 * minted its own identity (`sessionId#iteration#decisionOrdinal`)
	 * because the preparation id was not reachable here, which made the
	 * join inferential (chronological pairing) rather than authoritative.
	 *
	 * ABSENT (never synthesized) when the host did not supply one.
	 */
	preparationRequestId?: string;
	/**
	 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
	 *
	 * The formatting-relevant REQUEST OPTIONS of the request being prepared.
	 *
	 * They are forwarded so a private candidate capture can record the
	 * options that affect how the provider renders the candidate (thinking
	 * mode, reasoning effort, tool-choice, output limits). Without them the
	 * captured candidate could not be replayed equivalently.
	 *
	 * The capture NEVER records a credential: the option bag is filtered
	 * before it reaches the capture.
	 */
	requestOptions?: Readonly<Record<string, unknown>>;
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
	/**
	 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: the EFFECTIVE
	 * request-input ceiling this turn enforces.
	 *
	 * Published so the agent runtime can enforce the SAME ceiling against
	 * the FINAL provider request — the one that includes any `beforeModel`
	 * hook mutations. The runtime captures it verbatim and never resolves,
	 * relaxes, or invents a limit of its own.
	 *
	 * ADDITIVE-OPTIONAL. A host that publishes no ceiling leaves the
	 * runtime-side check disabled.
	 */
	maxRequestTokens?: number;
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
	/** Overrides layered over `config.compaction`. */
	compaction?: Partial<CoreCompactionConfig>;
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

/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
 *
 * Whether the PRIVATE candidate capture is armed for this process.
 *
 * The arming decision is read ONCE per process and cached, so the hot
 * decision path performs a boolean check rather than an environment read
 * on every turn.
 *
 * Reading the environment creates nothing and writes nothing.
 */
let privateCaptureArmed: boolean | undefined;

function privateCandidateCaptureArmed(): boolean {
	if (privateCaptureArmed === undefined) {
		privateCaptureArmed = isCompactionCandidateCaptureArmed();
	}
	return privateCaptureArmed;
}

/**
 * The private capture store for this process, created lazily.
 *
 * It is created ONLY when the capture is armed, so the default path
 * allocates no store and touches no filesystem.
 */
let privateCaptureStore: CompactionCandidateCaptureStore | undefined;

function resolvePrivateCaptureStore():
	| CompactionCandidateCaptureStore
	| undefined {
	if (privateCaptureStore) {
		return privateCaptureStore;
	}
	const directory = resolvePrivateCompactionCandidateCaptureDirectory();
	if (!directory) {
		// Fail closed: without an explicit ISOLATED storage root there is
		// nowhere provably private to write the candidate to.
		return undefined;
	}
	privateCaptureStore = new CompactionCandidateCaptureStore(directory);
	return privateCaptureStore;
}

/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
 *
 * Capture the exact pre-compaction CLIENT DECISION CANDIDATE.
 *
 * The capture is:
 *
 *   - SKIPPED entirely when the private opt-in is not armed (no
 *     serialization, no I/O, no state);
 *   - FAILURE-ISOLATED: a capture failure never changes the runtime's
 *     behaviour — it is swallowed and reported as an absent capture;
 *   - ONE-WAY: nothing is read back into the runtime.
 */
async function captureCompactionDecisionCandidate(input: {
	config: {
		providerId?: string;
		modelId?: string;
		sessionId?: string;
		logger?: CoreSessionConfig["logger"];
	};
	context: ContextPipelinePrepareTurnInput;
	decisionId: string | undefined;
	decisionOrdinal: number | undefined;
	requestInputTokens: number;
	requestTriggerTokens: number;
	shouldCompact: boolean;
	compactionInitiated: boolean;
}): Promise<void> {
	if (!privateCandidateCaptureArmed()) {
		return;
	}
	try {
		const store = resolvePrivateCaptureStore();
		if (!store) {
			// Fail closed: the capture is armed but no ISOLATED storage root
			// is configured, so there is nowhere provably private to write.
			return;
		}
		const candidate: CompactionCandidateSnapshot = {
			systemPrompt: input.context.systemPrompt,
			// The ALREADY-PREPARED API messages are captured verbatim. The
			// stateful `MessageBuilder` is NEVER called again here.
			apiMessages: input.context.apiMessages,
			tools: input.context.tools,
			options: filterCapturableRequestOptions(input.context.requestOptions),
			modelId: input.config.modelId,
			providerId: input.config.providerId,
			preparationRequestId: input.context.preparationRequestId,
			decisionId: input.decisionId,
		};
		store.record(candidate, input.compactionInitiated);
		const receipts = await store.flush(async (snapshot) => {
			const fingerprint = computeCandidateContentFingerprint({
				systemPrompt: snapshot.systemPrompt,
				apiMessages: snapshot.apiMessages,
				tools: snapshot.tools,
				options: snapshot.options,
			});
			return {
				kind: "compaction_candidate" as const,
				requestIdentity:
					snapshot.preparationRequestId ??
					snapshot.decisionId ??
					"unknown-request",
				representation: fingerprint.representation,
				snapshotComplete: true,
				contentFingerprint: fingerprint.fingerprint,
				estimatedInputTokens: input.requestInputTokens,
				requestTriggerTokens: input.requestTriggerTokens,
				// The candidate was NOT submitted: no provider ever reported
				// usage for it. The field is explicitly null, never zero.
				providerInputTokens: null,
				providerInputAuthority: "UNAVAILABLE_FROM_TRACE",
				compactionInitiated: input.compactionInitiated,
				decisionId: snapshot.decisionId,
				preparationRequestId: snapshot.preparationRequestId,
				payloadBytes: 0,
				truncated: false,
			};
		});
		for (const receipt of receipts) {
			input.config.logger?.debug?.("Private compaction candidate captured", {
				requestIdentity: receipt.requestIdentity,
				contentFingerprint: receipt.contentFingerprint,
				snapshotComplete: receipt.snapshotComplete,
				truncated: receipt.truncated,
				compactionInitiated: receipt.compactionInitiated,
			});
		}
	} catch {
		// Failure isolation: the capture never changes runtime behaviour.
	}
}

/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
 *
 * The PRIVATE diagnostic directory the candidate capture writes to.
 *
 * It is EXPLICITLY private: it lives under the ISOLATED dogfood storage
 * root in a `private/` subdirectory that the standard diagnostics exports
 * and the incident bundles never include.
 *
 * ## Fail-closed isolation (P0-3 correction)
 *
 * The storage root is the dogfood runtime's ACTUAL configured data
 * directory (`CLINE_DATA_DIR`, or `<CLINE_DIR>/data`). There is deliberately
 * NO `~/.cline/data` fallback: the shared default data directory is not
 * provably inside the isolated dogfood profile, and it may hold the
 * operator's real credentials and prompts. When no explicit root is
 * configured the capture is NOT armed at all.
 *
 * The directory is NOT created here — only its path is resolved. The store
 * creates it (with 0700) when it actually writes.
 */
function resolvePrivateCompactionCandidateCaptureDirectory():
	| string
	| undefined {
	const storageRoot = resolveCompactionCandidateCaptureStorageRoot();
	if (!storageRoot) {
		return undefined;
	}
	return join(storageRoot, "private", "compaction-candidates");
}

export function createContextCompactionPrepareTurn(
	config: Pick<
		CoreSessionConfig,
		| "providerConfig"
		| "providerId"
		| "modelId"
		| "apiKey"
		| "baseUrl"
		| "headers"
		| "compaction"
		| "logger"
		| "telemetry"
		| "sessionId"
		| "modelBehaviorTraceSink"
	>,
	options: ContextCompactionPrepareTurnOptions = {},
):
	| ((
			context: ContextPipelinePrepareTurnInput,
	  ) => Promise<ContextPipelinePrepareTurnResult | undefined>)
	| undefined {
	const userCompaction: CoreCompactionConfig = {
		...config.compaction,
		...options.compaction,
	};
	if (userCompaction.enabled !== true) {
		return undefined;
	}

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
	// ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — the DECISION ORDINAL.
	//
	// `(sessionId, iteration)` alone does NOT distinguish two eligibility
	// decisions inside the SAME iteration (a re-compaction attempt after a
	// failed summarizer call, for example). The ordinal is a per-session
	// monotonic counter that makes every decision observation uniquely
	// addressable within the session.
	//
	// It is incremented ONLY when an ACTUAL diagnostic sink is ARMED, so
	// the diagnostics-OFF path allocates no counter, keeps no state and
	// performs no decision-capture work beyond the sink presence check.
	let decisionOrdinal = 0;
	const traceSink = config.modelBehaviorTraceSink;
	const decisionDiagnosticsEnabled = (): boolean => {
		if (!traceSink) {
			return false;
		}
		try {
			// A sink without an enable bit is treated as ARMED: it may still
			// be a collecting sink that a test or a host reads directly.
			return traceSink.isTraceEnabled?.() !== false;
		} catch {
			return false;
		}
	};

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
		const modelMaxInputTokens = resolveEffectiveMaxInputTokens({
			maxInputTokens: context.model.info?.maxInputTokens,
			contextWindow: context.model.info?.contextWindow,
		});
		// ACT-CLINEMM-USER-CONTEXT-CEILING01 (R1 working-context authority):
		// the user's configured operating ceiling caps the canonical model
		// limit. It may only REDUCE the operating capacity, never expand it.
		const ceilingAdjustedMaxInputTokens = applyUserContextCeiling(
			modelMaxInputTokens,
			sanitizedUserContextCeiling,
		);
		// An unknown model limit is not evidence that the request is full.
		// Custom models can have any context window; using a guessed limit here
		// can trigger compaction even on a new session's system prompt/tools.
		// Manual compaction and provider-confirmed overflow recovery still need
		// a working budget, so only those modes use the default.
		if (
			effectiveMode === "auto" &&
			ceilingAdjustedMaxInputTokens === undefined
		) {
			return undefined;
		}
		const rawMaxInputTokens =
			ceilingAdjustedMaxInputTokens ?? DEFAULT_MAX_INPUT_TOKENS;
		// The char-based estimate under-counts dense content (disassembly, image
		// dumps, minified sources). When the provider's actual count for the
		// PREVIOUS request already exceeds our estimate for the (larger) current
		// transcript, the estimator is demonstrably under-counting, so scale the
		// whole budget down by that ratio. Scaling the budget rather than just the
		// trigger keeps every downstream number — trigger, target and the
		// projection's message costs — in the same estimate units while still
		// corresponding to the provider's real limit; raising only the trigger
		// would start a compaction that then retains too much and still overflows.
		//
		// Deliberately conservative: it never loosens the budget, engages only on
		// direct evidence of under-counting, and is capped so a tiny estimate
		// cannot collapse the budget.
		const actualPreviousInputTokens =
			typeof context.previousRequestInputTokens === "number" &&
			context.previousRequestInputTokens > 0
				? context.previousRequestInputTokens
				: 0;
		const underestimateFactor =
			actualPreviousInputTokens > 0 && requestInputTokens > 0
				? Math.min(
						MAX_INPUT_UNDERESTIMATE_FACTOR,
						Math.max(1, actualPreviousInputTokens / requestInputTokens),
					)
				: 1;
		const maxInputTokens = rawMaxInputTokens / underestimateFactor;
		const requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO;
		const messageTriggerTokens = translateRequestBudgetToMessages(
			requestTriggerTokens,
			requestOverheadTokens,
		);
		// Equivalent to comparing the provider's actual count against the unscaled
		// trigger, because the budget above already carries the ratio.
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
			rawMaxInputTokens,
			actualPreviousInputTokens,
			underestimateFactor,
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
		// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01: report the compaction
		// boundary into the model behavior timeline, alongside the effective
		// input-budget PROVENANCE.
		//
		// The provenance is resolved from the EXACT inputs the production
		// resolver above just consumed, so an operator can tell a genuine
		// model limit apart from the 128k fallback. The production policy
		// math is NOT re-implemented here — `resolveModelBehaviorTraceBudget`
		// mirrors it and is checked against it by the budget provenance
		// witness.
		const budgetResolution = resolveModelBehaviorTraceBudget({
			modelMaxInputTokens: context.model.info?.maxInputTokens,
			contextWindow: context.model.info?.contextWindow,
			userContextCeiling: sanitizedUserContextCeiling,
		});
		// ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — build the DECISION
		// RECORD only when an ACTUAL diagnostic sink is ARMED. With no
		// sink, or with a sink that explicitly reports itself disabled,
		// this path performs no ordinal allocation and no extra JSON
		// serialization of the provider-visible message array.
		// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — the DECISION
		// IDENTITY is hoisted out of the diagnostics-only block so the
		// private candidate capture can reference it too.
		//
		// The ordinal is allocated ONLY when an ACTUAL observer is armed (the
		// diagnostic sink OR the private capture). With neither armed, no
		// ordinal is allocated, no state is kept, and no serialization is
		// performed — the diagnostics-OFF path stays allocation-free.
		const decisionObservationArmed =
			decisionDiagnosticsEnabled() || privateCandidateCaptureArmed();
		let decisionOrdinalForObservation: number | undefined;
		let decisionIdForObservation: string | undefined;
		if (decisionObservationArmed) {
			decisionOrdinalForObservation = decisionOrdinal++;
			decisionIdForObservation = `${config.sessionId ?? "unknown-session"}#${context.iteration ?? 0}#${decisionOrdinalForObservation}`;
		}
		if (decisionDiagnosticsEnabled()) {
			observeCompactionTrace(
				config.modelBehaviorTraceSink,
				"diagnostics",
				{
					sessionId: config.sessionId,
					iteration: context.iteration,
					providerId: config.providerId,
					modelId: config.modelId,
					// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: the
					// PREPARATION REQUEST IDENTITY, forwarded VERBATIM from the
					// agent runtime. It is the id of the request this decision
					// actually measured, so the decision joins to the provider
					// dispatch and the provider-reported usage by an EXACT key.
					preparationRequestId: context.preparationRequestId,
				},
				{
					compactionMode: effectiveMode,
					compactionStrategy: strategy,
					requestInputTokens,
					maxInputTokens,
					requestTriggerTokens,
					userContextCeiling: sanitizedUserContextCeiling,
					shouldCompact,
					// ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — the DECISION
					// RECORD.
					//
					// The values below are the PRODUCTION resolver's OWN
					// results, already computed above. They are PUBLISHED here,
					// not recomputed: the tracer observes what the policy
					// actually used, and the captured arithmetic can therefore
					// be verified against the captured inputs.
					//
					// Before this, only a SUBSET reached the diagnostic, so a
					// consumer could not verify the captured `maxInputTokens`
					// against the captured `rawMaxInputTokens` and
					// `underestimateFactor` — the calibration step was
					// invisible, and the threshold was unauditable.
					//
					// Every field is a privacy-safe scalar: a token COUNT, a
					// ratio, a SIZE, a count or a classification. No message
					// text, tool result, prompt, URL or credential is carried.
					//
					// `actualPreviousInputTokens` is the PREVIOUS request's
					// provider-reported input usage — never the current
					// candidate's usage, which no provider ever reported
					// because the candidate was not submitted.
					apiMessageTokens,
					requestOverheadTokens,
					rawMaxInputTokens,
					actualPreviousInputTokens,
					underestimateFactor,
					messageCount: context.messages.length,
					apiMessageCount: context.apiMessages.length,
					apiMessagesJsonChars: safeJsonSize(context.apiMessages),
					// ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — the
					// DECISION IDENTITY.
					//
					// The `modelRequestId` is NOT available here: it is minted
					// in `streamPreparedRequest`, AFTER this seam returns. The
					// decision therefore carries its OWN stable identity —
					// `(sessionId, iteration, decisionOrdinal)` — and the
					// provider-dispatch join is established later, at the
					// seam that owns the request id.
					//
					// The ordinal is a per-session monotonic counter of
					// eligibility decisions. It distinguishes consecutive
					// decisions within the SAME iteration (a re-compaction
					// attempt), which `(sessionId, iteration)` alone cannot.
					decisionId: decisionIdForObservation,
					decisionOrdinal: decisionOrdinalForObservation,
					// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — the
					// AUTHORITATIVE JOIN KEY.
					//
					// `decisionId` remains the per-session monotonic DECISION
					// identity: it distinguishes two eligibility decisions inside
					// the SAME iteration (a re-compaction attempt), which
					// `(sessionId, iteration)` alone cannot.
					//
					// `preparationRequestId` is the PREPARATION identity. It is
					// forwarded verbatim from the agent runtime (minted BEFORE
					// this seam ran) and therefore joins this decision to the
					// request it measured, to the provider dispatch of that
					// request, and to the provider-reported usage.
					//
					// A provider RETRY against the same prepared request keeps
					// the SAME preparation id and receives a DIFFERENT provider
					// attempt id, so retries cannot double-count decisions.
					//
					// `decisionJoinAuthority` states whether the join is
					// AUTHORITATIVE (the preparation id was forwarded) or
					// UNAVAILABLE (the host did not supply one). It is never
					// reported as authoritative when the id is absent.
					...(context.preparationRequestId !== undefined
						? {
								preparationRequestId: context.preparationRequestId,
								decisionJoinAuthority: "AUTHORITATIVE",
							}
						: { decisionJoinAuthority: "UNAVAILABLE" }),
					// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the ELIGIBILITY-CHECK
					// discriminator.
					//
					// `shouldCompact` alone is NOT the answer to "did real
					// compaction work begin?". In `auto` mode it answers
					// "should it?", and the seam returns `undefined`
					// immediately afterwards when it is false. In
					// `manual` and `overflow_recovery` modes the seam ALWAYS
					// proceeds to real work, whatever `shouldCompact` says.
					//
					// `compactionInitiated` answers the question the
					// measurement actually needs: it is true exactly when
					// this seam proceeds PAST the decision point and begins
					// real compaction work. A consumer that opens a span on
					// the diagnostics channel can therefore distinguish a
					// no-op eligibility CHECK from an INITIATED compaction,
					// and bound its span to the real execution.
					//
					// It is a boolean CLASSIFICATION, not content.
					compactionInitiated: effectiveMode !== "auto" || shouldCompact,
					// The ACT's required provenance field.
					inputBudgetSource: budgetResolution.source,
					effectiveMaxInputTokens: budgetResolution.effectiveMaxInputTokens,
					usedFallbackBudget: budgetResolution.usedFallback,
				},
			);
		}
		// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — the PRIVATE
		// CANDIDATE CAPTURE, at the ACTUAL DECISION BOUNDARY.
		//
		// The capture happens HERE: AFTER the decision arithmetic and the
		// decision record, and BEFORE any compaction work. That is the only
		// point at which the already-prepared inputs are still exactly the
		// inputs the decision measured.
		//
		// The stateful `MessageBuilder` is NEVER called again here — the
		// already-prepared `apiMessages` are captured verbatim. The captured
		// objects are never mutated.
		//
		// The capture is ONE-WAY: nothing is read back into the runtime, so
		// it cannot influence the request, the dispatch or the run.
		//
		// It runs ONLY when the separate private opt-in is armed. With the
		// opt-in off, this path performs no serialization and no I/O at all.
		await captureCompactionDecisionCandidate({
			config,
			context,
			decisionId: decisionIdForObservation,
			decisionOrdinal: decisionOrdinalForObservation,
			requestInputTokens,
			requestTriggerTokens,
			shouldCompact,
			compactionInitiated: effectiveMode !== "auto" || shouldCompact,
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
			// Resolved per turn from the live session config, with the same
			// precedence as the main request, so the summarizer never sends
			// credentials the host has since refreshed or replaced.
			providerConfig: {
				...resolveConnectionProviderConfig(config),
				abortSignal: context.abortSignal,
			},
			compaction: userCompaction,
			estimateMessageTokens,
			logger: config.logger,
		};
		let executedStrategy = telemetryStrategy;
		let result: CoreCompactionResult | undefined;
		// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the TRUTHFUL TERMINAL OUTCOME
		// of an INITIATED compaction that ABORTED or FAILED.
		//
		// The span was opened by the diagnostics channel (the seam decided
		// to compact), so it must be closed with the OBSERVED outcome when
		// the work aborts. Without this the span is left open and the
		// tracer reports a `"span left open"` integrity failure — the very
		// defect this ACT repairs — and a cancelled compaction would be
		// indistinguishable from a check that never ran.
		//
		// The outcome is derived from the seam's OWN authority (the abort
		// signal and the cancellation classifier), never guessed.
		try {
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
							(total: number, message) =>
								total + estimateMessageTokens(message),
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
		} catch (error) {
			// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — close the INITIATED
			// compaction's span with the OBSERVED terminal outcome before
			// the error propagates.
			//
			// The outcome is derived from the seam's own authority: an
			// abort (the signal fired, or the error IS a cancellation) is
			// a CANCELLATION; anything else is a FAILURE. Neither is a
			// success, and neither is reported as one.
			const cancelled = isCompactionCancellation(error, context.abortSignal);
			observeCompactionTrace(
				config.modelBehaviorTraceSink,
				"completed",
				{
					sessionId: config.sessionId,
					iteration: context.iteration,
					providerId: config.providerId,
					modelId: config.modelId,
					// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: the
					// preparation identity is forwarded on the COMPLETION
					// record too, so the compaction execution joins to the same
					// prepared request as the decision that caused it.
					preparationRequestId: context.preparationRequestId,
				},
				{
					mode: effectiveMode,
					strategy: executedStrategy,
					requestInputTokens,
					maxInputTokens,
					requestTriggerTokens,
					compactionMessagesBefore: beforeMessageCount,
					compactionOutcome: cancelled ? "cancelled" : "failed",
				},
			);
			throw error;
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
			// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01: report the compaction COMPLETION
			// boundary so the timeline carries the before/after token boundary in
			// the same sequence as the model requests and tool executions.
			//
			// ACT-CLINEMM-ROUND-C-HARNESS-02: the completion ALSO carries the
			// EVIDENCE REFERENCE CONTINUITY — how many of the tool-call
			// references present before the compaction are still present
			// after it.
			//
			// This is the measurement that makes the compaction evidence
			// gap QUANTIFIABLE at the seam: the Round C session dropped 202
			// of 208 tool results, and a reader of this payload can now see
			// the same number reported by the compaction itself rather than
			// inferring it afterwards from a lossy sidecar.
			//
			// Only COUNTS are reported. No reference, no content and no
			// summary text is recorded.
			const evidenceRefsBefore = collectToolCallReferenceIds(context.messages);
			const evidenceRefsAfter = collectToolCallReferenceIds(result.messages);
			const evidenceRefsRetained = countRetainedReferenceIds(
				evidenceRefsBefore,
				evidenceRefsAfter,
			);
			const evidenceRefsDropped =
				evidenceRefsBefore.size - evidenceRefsRetained;
			const evidenceRefsReplaced = countReplacementReferenceIds(
				evidenceRefsBefore,
				evidenceRefsAfter,
			);
			observeCompactionTrace(
				config.modelBehaviorTraceSink,
				"completed",
				{
					sessionId: config.sessionId,
					iteration: context.iteration,
					providerId: config.providerId,
					modelId: config.modelId,
					// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: the
					// preparation identity is forwarded on the COMPLETION
					// record too, so the compaction execution joins to the same
					// prepared request as the decision that caused it.
					preparationRequestId: context.preparationRequestId,
				},
				{
					mode: effectiveMode,
					strategy: executedStrategy,
					requestInputTokens,
					maxInputTokens,
					requestTriggerTokens,
					userContextCeiling: sanitizedUserContextCeiling,
					inputBudgetSource: budgetResolution.source,
					tokensBefore: requestInputTokens,
					tokensAfter: afterRequestTokens,
					tokensSaved: requestInputTokens - afterRequestTokens,
					messagesBefore: beforeMessageCount,
					messagesAfter: result.messages.length,
					compactionMessagesBefore: beforeMessageCount,
					compactionMessagesAfter: result.messages.length,
					compactionMessagesRemoved:
						beforeMessageCount - result.messages.length,
					compactionEvidenceRefsBefore: evidenceRefsBefore.size,
					compactionEvidenceRefsAfter: evidenceRefsAfter.size,
					compactionEvidenceRefsRetained: evidenceRefsRetained,
					compactionEvidenceRefsDropped: evidenceRefsDropped,
					compactionEvidenceRefsReplaced: evidenceRefsReplaced,
					// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the OBSERVED
					// terminal outcome. This compaction produced a
					// transcript, so it completed.
					compactionOutcome: "completed",
				},
			);
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
			// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the TRUTHFUL TERMINAL
			// OUTCOME of an INITIATED compaction that produced no
			// transcript.
			//
			// The compaction WORK ran (the diagnostics opened the span),
			// but the strategy returned no result, so there is nothing to
			// complete. Reporting the terminal outcome here is what keeps
			// the span from being left open — and reporting it as a
			// FAILURE is what keeps it from being recorded as a
			// successful completion.
			observeCompactionTrace(
				config.modelBehaviorTraceSink,
				"completed",
				{
					sessionId: config.sessionId,
					iteration: context.iteration,
					providerId: config.providerId,
					modelId: config.modelId,
					// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: the
					// preparation identity is forwarded on the COMPLETION
					// record too, so the compaction execution joins to the same
					// prepared request as the decision that caused it.
					preparationRequestId: context.preparationRequestId,
				},
				{
					mode: effectiveMode,
					strategy: executedStrategy,
					requestInputTokens,
					maxInputTokens,
					requestTriggerTokens,
					compactionMessagesBefore: beforeMessageCount,
					compactionOutcome: "failed",
				},
			);
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

/**
 * Compaction policy for resuming a session imported from another coding agent.
 * The imported transcript keeps that agent's tool names and input schemas
 * verbatim, which a model continuing it may try to call, so the first turn
 * folds the whole foreign history into a summary before the model request
 * (manual mode, agentic strategy, nothing preserved but the new prompt).
 * Runs regardless of the session's auto-compaction setting, tags its status
 * notices with `importedFrom` so clients can label the wait, and on failure
 * falls back to the raw transcript. It makes one attempt per session start
 * (an aborted attempt does not count) and stands down once the working
 * context already opens with a compaction summary, which is how a resumed
 * sidecar presents; every other turn defers to `next`, the session's normal
 * compaction (if any).
 */
export function createImportedHistoryCompactionPrepareTurn(input: {
	config: Parameters<typeof createContextCompactionPrepareTurn>[0];
	/** Source tool id from the session's `importedFrom` metadata. */
	importedFrom: string;
	next?: ContextPipelinePrepareTurn;
}): ContextPipelinePrepareTurn {
	// Pass the live config through (not a copy) so the summary uses the
	// credentials and model current on the resumed turn.
	const summarize = createContextCompactionPrepareTurn(input.config, {
		mode: "manual",
		compaction: { enabled: true, strategy: "agentic", preserveRecentTokens: 0 },
	});
	let pending = summarize !== undefined;
	return async (context) => {
		if (pending && summarize && findLatestSummaryIndex(context.messages) < 0) {
			try {
				const result = await summarize({
					...context,
					emitStatusNotice: (message, metadata) =>
						context.emitStatusNotice?.(message, {
							...metadata,
							importedFrom: input.importedFrom,
						}),
				});
				pending = false;
				if (result?.messages) return result;
			} catch (error) {
				if (context.abortSignal.aborted) throw error;
				pending = false;
				input.config.logger?.log(
					"Failed to summarize imported session on resume; continuing with the raw transcript",
					{
						severity: "warn",
						sessionId: input.config.sessionId,
						...describeCompactionError(error),
					},
				);
			}
		}
		return input.next?.(context);
	};
}

export function createCompactionStateAwarePrepareTurn(input: {
	compact?: ContextPipelinePrepareTurn;
	getState?: () => SessionCompactionState | undefined;
	/**
	 * The runtime's provider-request transform (extension message builders +
	 * `MessageBuilder.buildForApi`), i.e. what produced `context.apiMessages`
	 * from `context.messages`. Re-compaction swaps in a projected transcript
	 * and must estimate against its API-safe form, not the raw projection.
	 */
	prepareApiMessages: (
		messages: CoreCompactionContext["messages"],
	) => Promise<CoreCompactionContext["messages"]>;
	/**
	 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: an ISOLATED,
	 * accounting-only provider projection used by the request-budget guard.
	 *
	 * The guard must measure the PROVIDER-VISIBLE representation of the
	 * contracted candidate. It cannot use `prepareApiMessages` for that,
	 * because the production `MessageBuilder` is STATEFUL: an extra,
	 * accounting-only build would mutate its sticky cross-call state and
	 * could change a LATER real build (stale-read rewriting decisions).
	 *
	 * This callback MUST therefore build the projection with a fresh,
	 * short-lived builder that leaves the production builder untouched.
	 *
	 * When absent, the guard falls back to measuring the internal
	 * representation — the conservative choice (it can only reject more,
	 * never less).
	 */
	prepareBudgetAccountingMessages?: (
		messages: CoreCompactionContext["messages"],
	) => Promise<CoreCompactionContext["messages"]>;
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
	/**
	 * ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01: an
	 * additional ceiling on the effective request input limit, applied on top
	 * of the model limit and the context window. Production callers pass the
	 * user's configured operating ceiling here; it may only REDUCE the
	 * operating capacity, never expand it.
	 */
	maxRequestTokens?: number;
}): ContextPipelinePrepareTurn {
	return async (context) => {
		const existingState = input.getState?.();
		const projectedMessages = existingState
			? projectSessionCompactionState(existingState, context.messages)
			: undefined;
		// ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01:
		// the effective request input limit, resolved with the SAME existing
		// limit resolvers the compaction budget machinery uses (model limit +
		// context window), and then reduced — never expanded — by the
		// caller's operating ceiling.
		const contractMaxRequestTokens = applyUserContextCeiling(
			resolveEffectiveMaxInputTokens({
				maxInputTokens: context.model.info?.maxInputTokens,
				contextWindow: context.model.info?.contextWindow,
			}),
			input.maxRequestTokens,
		);
		/**
		 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: the ISOLATED
		 * accounting projection used both by the budget guard and by the
		 * published working-context estimate.
		 *
		 * It MUST NOT use the long-lived production `MessageBuilder`: that
		 * builder is STATEFUL, and an extra accounting-only build would
		 * mutate its sticky cross-call state and could change a LATER real
		 * build. When the host supplies the isolated projection it is used;
		 * otherwise the production transform is used as a fallback (the
		 * conservative choice — it can only over-count, never under-count).
		 */
		const budgetProjection = async (
			messages: readonly CoreCompactionContext["messages"][number][],
		): Promise<CoreCompactionContext["messages"]> => {
			const project =
				input.prepareBudgetAccountingMessages ?? input.prepareApiMessages;
			return await project([...messages]);
		};
		const contractBudget = (
			systemPrompt: string,
		): {
			maxRequestTokens: number | undefined;
			systemPrompt: string;
			tools: readonly unknown[];
			providerMessages: (
				messages: readonly CoreCompactionContext["messages"][number][],
			) => Promise<readonly unknown[]>;
		} => ({
			maxRequestTokens: contractMaxRequestTokens,
			systemPrompt,
			tools: context.tools,
			// ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: the guard
			// measures the PROVIDER-VISIBLE representation of the candidate,
			// produced by the runtime's provider-request transform. The
			// transform is applied to the CONTRACTED list (the guard passes
			// the list it is about to measure), so the measured shape is
			// exactly the one the provider would receive.
			//
			// The projection is taken with the ISOLATED accounting builder
			// (`prepareBudgetAccountingMessages`), NOT with
			// `prepareApiMessages`. The production `MessageBuilder` is
			// STATEFUL — an extra, accounting-only build on the long-lived
			// production builder would mutate its sticky cross-call state
			// and could change a LATER real build. The isolated builder
			// produces the same projection while leaving the production
			// builder untouched.
			//
			// The input list has NOT been through the provider transform
			// before (it is the freshly-compacted candidate), so the
			// provider-request preparation is never applied twice to the same
			// input and the dispatched request is unchanged.
			providerMessages: async (messages) => await budgetProjection(messages),
		});
		if (existingState && projectedMessages) {
			// Re-compaction intentionally starts from the compacted projection plus
			// canonical tail. This keeps automatic turns bounded without rebuilding a
			// full-transcript summary every turn; manual `/compact` is the path for a
			// fresh summary from canonical history.
			const result = input.compact
				? await input.compact({
						...context,
						messages: projectedMessages,
						apiMessages: await input.prepareApiMessages(projectedMessages),
					})
				: undefined;
			if (result?.messages) {
				// ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01:
				// carry the active task contract forward from the CANONICAL
				// history into the freshly produced compaction summary, before
				// persistence and before provider preparation. The canonical
				// history is the only authority; a previous summary never
				// becomes one.
				const systemPrompt = result.systemPrompt ?? existingState.system_prompt;
				const contracted = await applyTaskContractToCompactedMessages(
					result.messages,
					context.messages,
					contractBudget(systemPrompt ?? context.systemPrompt),
				);
				// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-RECON01: carry the
				// VERIFIED tool outcomes forward from the CANONICAL history into
				// the freshly produced compaction summary, before persistence
				// and before provider preparation.
				//
				// The generated summary is a LOSSY PROJECTION of the canonical
				// history: it can drop an operation that actually executed
				// successfully, and the continuing model then reports it as
				// NOT_EXECUTED - a statement the canonical record contradicts.
				// The carried section is DETERMINISTIC and derived from the
				// canonical tool-call/result pairs, so it never depends on the
				// summary prose that lost the evidence.
				//
				// It is applied AFTER the task contract so the two
				// carry-forwards compose without either overwriting the
				// other's section.
				const evidenced = applyVerifiedEvidenceToCompactedMessages(
					contracted.messages,
					context.messages,
				);
				const contractedMessages = evidenced.messages;
				const nextState = createSessionCompactionState({
					sourceMessages: context.messages,
					compactedMessages: contractedMessages,
					conversationId: context.conversationId,
					systemPrompt,
				});
				await input.saveState?.(nextState, context.messages);
				return publishWorkingContextEstimate(
					contractedMessages,
					systemPrompt ?? context.systemPrompt,
					context.tools,
					contractMaxRequestTokens,
				);
			}
			const projectedSystemPrompt =
				result?.systemPrompt ?? existingState.system_prompt;
			// ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01:
			// provider-visible restoration for a historical sidecar that was
			// written before this repair and therefore lacks the contract. The
			// persisted sidecar is NOT rewritten on read; only the projection
			// the model receives is enriched. The raw projector remains a
			// faithful projection of the sidecar.
			const restored = await applyTaskContractToCompactedMessages(
				projectedMessages,
				context.messages,
				contractBudget(projectedSystemPrompt ?? context.systemPrompt),
			);
			// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-RECON01: the same
			// provider-visible restoration for the VERIFIED tool outcomes - a
			// historical sidecar written before this repair carries no
			// verified-outcome section, so the projection the model receives
			// is enriched from the canonical history. The persisted sidecar is
			// NOT rewritten on read.
			const restoredWithEvidence = applyVerifiedEvidenceToCompactedMessages(
				restored.messages,
				context.messages,
			);
			return publishWorkingContextEstimate(
				restoredWithEvidence.messages,
				projectedSystemPrompt ?? context.systemPrompt,
				context.tools,
				contractMaxRequestTokens,
			);
		}
		const result = input.compact ? await input.compact(context) : undefined;
		if (result?.messages) {
			// ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01: carry
			// the active task contract forward from the CANONICAL history into
			// the freshly produced compaction summary, before persistence and
			// before provider preparation.
			const contracted = await applyTaskContractToCompactedMessages(
				result.messages,
				context.messages,
				contractBudget(result.systemPrompt ?? context.systemPrompt),
			);
			// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-RECON01: carry the
			// VERIFIED tool outcomes forward from the CANONICAL history into the
			// freshly produced compaction summary, before persistence and
			// before provider preparation.
			const evidenced = applyVerifiedEvidenceToCompactedMessages(
				contracted.messages,
				context.messages,
			);
			const contractedMessages = evidenced.messages;
			const nextState = createSessionCompactionState({
				sourceMessages: context.messages,
				compactedMessages: contractedMessages,
				conversationId: context.conversationId,
				systemPrompt: result.systemPrompt,
			});
			await input.saveState?.(nextState, context.messages);
			return publishWorkingContextEstimate(
				contractedMessages,
				result.systemPrompt ?? context.systemPrompt,
				context.tools,
				contractMaxRequestTokens,
			);
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
			contractMaxRequestTokens,
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
async function publishWorkingContextEstimate(
	messages: CoreCompactionContext["messages"],
	systemPrompt: string,
	tools: readonly unknown[],
	/**
	 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: the effective
	 * request-input ceiling this turn enforces. Published so the agent
	 * runtime can enforce the SAME ceiling against the FINAL provider
	 * request — the one that includes any `beforeModel` hook mutations.
	 */
	maxRequestTokens?: number,
): Promise<ContextPipelinePrepareTurnResult> {
	// ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: W keeps its
	// EXISTING contract — the canonical estimator over the final internal
	// request shape. The working-context estimate is a DISPLAY /
	// occupancy signal with its own pinned contract
	// (`compaction.working-context-authority-publish.test.ts`); changing
	// its semantics is NOT part of this repair and would silently change
	// the compaction trigger's relationship to W.
	//
	// The REQUEST-BUDGET AUTHORITY is a separate concern and is repaired
	// in `applyTaskContractToCompactedMessages()`, which measures the
	// provider-visible representation of the candidate.
	return {
		messages,
		systemPrompt,
		currentWorkingContextEstimate: estimateRequestInputTokens({
			systemPrompt,
			messages,
			tools,
		}),
		...(maxRequestTokens === undefined ? {} : { maxRequestTokens }),
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
async function publishWorkingContextEstimateMetadataOnly(
	messages: CoreCompactionContext["messages"],
	systemPrompt: string,
	tools: readonly unknown[],
	/**
	 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: the effective
	 * request-input ceiling this turn enforces. Published on the
	 * metadata-only return as well, so the runtime-side final-request check
	 * is active on EVERY prepare turn — not only on turns that compacted.
	 */
	maxRequestTokens?: number,
): Promise<ContextPipelinePrepareTurnResult> {
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
	const measuredMessages = messages;
	return {
		currentWorkingContextEstimate: estimateRequestInputTokens({
			systemPrompt,
			messages: measuredMessages,
			tools,
		}),
		...(maxRequestTokens === undefined ? {} : { maxRequestTokens }),
	};
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01: report one compaction observation to
 * the read-only model behavior trace sink.
 *
 * Failure isolation: a throwing sink can never affect the compaction
 * policy, the compaction strategy, or the model request that follows.
 */
/**
 * Collect the tool-call reference identities in a set of messages.
 *
 * ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION01.
 *
 * A "tool-call reference" is a tool RESULT — the evidence the model would
 * have read. Retention is an IDENTITY question, not a cardinality
 * question: a compaction that replaces ten original references with ten
 * unrelated references retains none of them.
 *
 * The identities are used only inside this module to compute COUNTS.
 * No reference id and no content is emitted to telemetry.
 */
function collectToolCallReferenceIds(
	messages: readonly {
		readonly content?:
			| string
			| readonly {
					readonly type?: string;
					readonly id?: string;
					readonly tool_use_id?: string;
			  }[];
	}[],
): Set<string> {
	const ids = new Set<string>();
	for (const message of messages) {
		const content = message.content;
		if (typeof content === "string") {
			continue;
		}
		for (const part of content ?? []) {
			if (part.type !== "tool-result" && part.type !== "tool_result") {
				continue;
			}
			const id = part.tool_use_id ?? part.id;
			if (typeof id === "string" && id.length > 0) {
				ids.add(id);
			}
		}
	}
	return ids;
}

/** The number of original identities that survived the compaction. */
function countRetainedReferenceIds(
	before: ReadonlySet<string>,
	after: ReadonlySet<string>,
): number {
	let retained = 0;
	for (const id of before) {
		if (after.has(id)) {
			retained += 1;
		}
	}
	return retained;
}

/**
 * The number of post-compaction identities that did NOT exist before.
 *
 * These are REPLACEMENTS: the compaction emitted a different evidence
 * reference rather than retaining the original one. They are reported
 * separately from retained and dropped identities so an equal-count,
 * disjoint-reference compaction cannot masquerade as full retention.
 */
function countReplacementReferenceIds(
	before: ReadonlySet<string>,
	after: ReadonlySet<string>,
): number {
	let replaced = 0;
	for (const id of after) {
		if (!before.has(id)) {
			replaced += 1;
		}
	}
	return replaced;
}

/**
 * Report a compaction observation to the trace sink.
 *
 * The helper is failure-isolated: a throwing sink must never change the
 * compaction's behaviour.
 */
function observeCompactionTrace(
	sink:
		| {
				onCompactionDiagnostics?: (observation: {
					sessionId?: string;
					iteration?: number;
					providerId?: string;
					modelId?: string;
					preparationRequestId?: string;
					payload: Record<string, unknown>;
				}) => void;
				onCompactionCompleted?: (observation: {
					sessionId?: string;
					iteration?: number;
					providerId?: string;
					modelId?: string;
					preparationRequestId?: string;
					payload: Record<string, unknown>;
				}) => void;
		  }
		| undefined,
	channel: "diagnostics" | "completed",
	identity: {
		sessionId?: string;
		iteration?: number;
		providerId?: string;
		modelId?: string;
		/**
		 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: the preparation
		 * request identity, forwarded so the decision joins to the request it
		 * measured.
		 */
		preparationRequestId?: string;
	},
	payload: Record<string, unknown>,
): void {
	if (!sink) {
		return;
	}
	try {
		// ACT-CLINEMM-ROUND-C-HARNESS-02: the channel is invoked AS A
		// METHOD on the sink object.
		//
		// Passing the extracted function (`handler`) and calling it detached
		// loses the receiver, so a stateful adapter — the latency sink — threw
		// on `this.record(...)`. The failure was swallowed by the isolation
		// catch below, so the compaction boundary never appeared in the trace
		// even though the runtime believed it had reported it.
		const observation = {
			...(identity.sessionId !== undefined
				? { sessionId: identity.sessionId }
				: {}),
			...(identity.iteration !== undefined
				? { iteration: identity.iteration }
				: {}),
			...(identity.providerId !== undefined
				? { providerId: identity.providerId }
				: {}),
			...(identity.modelId !== undefined ? { modelId: identity.modelId } : {}),
			// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: forward the
			// preparation identity verbatim. It is OBSERVED (forwarded), never
			// synthesized.
			...(identity.preparationRequestId !== undefined
				? { preparationRequestId: identity.preparationRequestId }
				: {}),
			payload,
		};
		if (channel === "diagnostics") {
			if (!sink.onCompactionDiagnostics) {
				return;
			}
			sink.onCompactionDiagnostics(observation);
			return;
		}
		if (!sink.onCompactionCompleted) {
			return;
		}
		sink.onCompactionCompleted(observation);
	} catch {
		// Failure isolation: the recorder must never affect compaction.
	}
}
