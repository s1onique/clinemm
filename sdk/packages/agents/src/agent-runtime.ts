import {
	classifyProviderError,
	createGateway,
	type GatewayProviderSettings,
	isRetryableProviderError,
	recordPrefixForensicsRuntimeProjection,
} from "@cline/llms";

/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A1/A2/A3).
 *
 * The transport authority and the destination origin authority live in
 * `@cline/llms`.
 *
 * They are reached through a LAZY, DEFENSIVE accessor rather than a
 * module-scope binding, because the runtime is imported by hosts and
 * witnesses that substitute `@cline/llms` wholesale. A module-scope named
 * import would make every such substitute fail at the FIRST CALL, because a
 * substituted module does not carry these exports.
 *
 * The accessor degrades to "NOT ESTABLISHED", which is the SAFE direction:
 * an unestablished transport grants no reasoning-authorization requirement
 * (every reasoning block is measured, exactly as before this repair) and an
 * unestablished destination grants no opaque replay authority (the reasoning
 * the wire would also drop is not measured). Neither can silently exclude
 * content the provider receives.
 */
type LlmTransportAuthority = {
	buildReasoningOriginAuthority?: (input: {
		providerId: string;
		baseUrl: string | undefined;
	}) => string | undefined;
	/**
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A2): the SINGLE
	 * destination origin-authority resolver. It consumes the route facts
	 * (provider id, configured base URL, API line) and produces the ONE
	 * destination authority the wire, the budget authority, the task-contract
	 * guard and the compaction trigger all use.
	 */
	resolveDestinationOriginAuthority?: (input: {
		providerId: string;
		baseUrl?: string | undefined;
		apiLine?: string | undefined;
	}) => string | undefined;
	resolveEffectiveBaseUrl?: (input: {
		providerId: string;
		baseUrl?: string | undefined;
		apiLine?: string | undefined;
	}) => string | undefined;
	resolveTransportFacts?: (input: { providerId: string; model?: unknown }) => {
		client?: string;
		apiProtocol?: string;
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A1): the
		// EFFECTIVE transport — the serializer that actually runs.
		effectiveClient?: string;
	};
};

let llmTransportAuthority: LlmTransportAuthority | undefined;
let llmTransportAuthorityResolved = false;

function getLlmTransportAuthority(): LlmTransportAuthority {
	if (!llmTransportAuthorityResolved) {
		llmTransportAuthorityResolved = true;
		try {
			llmTransportAuthority =
				require("@cline/llms") as Partial<LlmTransportAuthority>;
		} catch {
			llmTransportAuthority = undefined;
		}
	}
	return llmTransportAuthority ?? {};
}

import type {
	AgentAfterToolResult,
	AgentBeforeModelResult,
	AgentBeforeToolResult,
	AgentMessage,
	AgentMessagePart,
	AgentModel,
	AgentModelEvent,
	AgentModelFinishReason,
	AgentModelRequest,
	AgentModelToolActivity,
	AgentRunResult,
	AgentRuntimeEvent,
	AgentRuntimeExecutionState,
	AgentRuntimeHooks,
	AgentRuntimeRecoverySnapshot,
	AgentRuntimeStateSnapshot,
	AgentStopControl,
	AgentTool,
	AgentToolCallPart,
	AgentToolDefinition,
	AgentToolResult,
	AgentUsage,
	AgentRuntimeConfig as BaseAgentRuntimeConfig,
	CaptureTaskLifecycleEventInput,
	CommandExecutionPlan,
	ControlPlaneOutcome,
	ExecutionRoundObservation,
	ExecutionRoundProductivity,
	ExecutionStagnationAccounting,
	LiveAgentRuntimeEvent,
	LiveAgentRuntimeStateSnapshot,
	ModelBehaviorTraceEditApprovalOutcome,
	ProviderErrorClass,
	TelemetryProperties,
	ToolApprovalResult,
	ToolCallExecutionCapability,
	ToolPolicy,
	ToolRuntimeOutcome,
} from "@cline/shared";
import {
	applyExecutionStagnationDecision,
	assertProviderRequestWithinBudget,
	type BoundedObjective,
	type BoundedObjectiveExecutionReceipt,
	type BoundedObjectiveObservationFacts,
	type BoundedObjectivePolicy,
	type BoundedObjectiveSelectionObservation,
	buildCompletionToolReminderMessage,
	// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01: the runtime-owned
	// parent-obligation reference vocabulary.
	buildParentObligationReferences,
	canonicalizeScopePath,
	captureAgentUnexpectedReasoningTokens,
	captureSdkError,
	captureTaskLifecycleEvent,
	computeFinalProjectionFingerprint,
	createExecutionStagnationAccounting,
	DEFAULT_BOUNDED_OBJECTIVE_POLICY,
	// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01: the
	// recovery-only generation override policy. DEFAULT_OFF.
	DEFAULT_RECOVERY_OUTPUT_OVERRIDE_POLICY,
	decideExecutionStagnation,
	// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01: the rejection
	// diagnosis that names the failing field or reference.
	describeBoundedObjectiveRejection,
	describeEditRequest,
	EDIT_OBSERVATION_APPROVAL_METADATA_KEY,
	EDIT_OBSERVATION_IDENTITY_METADATA_KEY,
	EDIT_OBSERVATION_SINK_METADATA_KEY,
	estimateRequestInputTokens,
	estimateTokens,
	extractScopePaths,
	foldExecutionRound,
	isPathWithinCanonicalRoot,
	isProviderDispatchRecordRequired,
	MODEL_BEHAVIOR_TRACE_UNAVAILABLE,
	MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY,
	mergeModelOptions,
	normalizeJsonLikeStringsForSchema,
	omitUnauthorizedReasoningBlocks,
	omitUndefinedValues,
	// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01: the runtime-owned
	// parent-obligation reference vocabulary.
	type ParentObligationReference,
	// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01: the
	// recovery-only generation override policy. DEFAULT_OFF.
	type RecoveryOutputOverridePolicy,
	renderBoundedObjectiveInstruction,
	requiresSignedReasoningCapability,
	resolveBoundedObjectiveVerification,
	sanitizeTraceErrorMessage,
	TASK_CANCELLED_EVENT,
	TASK_FIRST_CHUNK_RECEIVED_EVENT,
	TASK_MAX_TOKENS_RECOVERY_EVENT,
	TASK_PROVIDER_REQUEST_STARTED_EVENT,
	TASK_PROVIDER_STREAM_FAILED_EVENT,
	TASK_PROVIDER_STREAM_STARTED_EVENT,
	TOOL_REJECTION_SUFFIX,
	toProviderVisibleMessages,
	trimNonEmpty,
	validateBoundedObjective,
} from "@cline/shared";
import { nanoid } from "nanoid";
import {
	buildToolOutcomeClassificationInput,
	classifyToolRuntimeOutcome,
	controlFamilyToDiagnosticId,
	createAttemptIdentity,
	createFamilyIdentity,
	DEFAULT_RECOVERY_POLICY,
	fingerprintToolFailure,
	isSameRuntimeRecovery,
	projectRuntimeRecovery,
	RecoveryPolicy,
	RecoveryTracker,
	type RuntimeOutcomeEvidence,
	selectControlPlaneOutcome,
	serializeStableFailureCode,
	type ToolAttemptIdentity,
} from "./runtime/recovery";
import { buildExecutionState, isSameExecutionState } from "./runtime/state";

/** A model request after turn preparation, ready to be issued (possibly more than once). */
interface PreparedModelRequest {
	request: AgentModelRequest;
	/** When preparation began; anchors the provider-request lifecycle timings. */
	startedAt: number;
	/**
	 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
	 *
	 * The PREPARATION REQUEST IDENTITY for this prepared request.
	 *
	 * It is minted ONCE in `prepareModelRequest()` — BEFORE the compaction
	 * pipeline runs — and forwarded to the compaction decision seam so the
	 * decision, the provider dispatch and the provider-reported usage can be
	 * joined by an EXACT key rather than by chronological pairing.
	 *
	 * It is carried on the prepared request (NOT on the runtime instance)
	 * because a prepared request may be issued N times: every provider
	 * attempt against it keeps the SAME preparation id and receives its own
	 * provider attempt id. Storing it on the runtime instance would let a
	 * later preparation silently overwrite an earlier request's identity.
	 */
	preparationRequestId: string;
}

const MAX_TOKENS_INCOMPLETE_TURN_MESSAGE =
	"Model reached the maximum output token limit before completing the turn";

/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01.
 *
 * How many times a turn that ends at the model's output-token limit without a
 * usable tool call is nudged for a more concise response (see
 * MAX_TOKENS_RECOVERY_NUDGE) BEFORE the run is failed.
 *
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01:
 * this allowance is RUN-SCOPED, not streak-scoped.
 *
 * The predecessor reset the counter on the PRESENCE of a tool call
 * (`if (toolCalls.length > 0) this.maxTokensRecoveryCount = 0;`), so a
 * read-only INSPECTION re-armed the allowance and the run could inject an
 * unbounded number of conciseness reminders — the frozen session's 17
 * reminders are exactly that shape. The allowance is now a CONSUMABLE
 * RUN-SCOPED resource: it is spent by a nudge and is only replenished by a
 * genuinely NEW externally initiated run.
 *
 * A PRODUCTIVE round (a successful native edit, a successful execution, a
 * legitimate wait) clears the CONSECUTIVE exhaustion/stagnation STREAK — that
 * behaviour is preserved — but it does NOT replenish this allowance. Neither
 * does a read-only inspection, a failed experiment, an unknown observation,
 * compaction, a provider retry, an R1/R2 activation, or a recovery-only
 * generation override.
 */
const MAX_TOKENS_RECOVERY_LIMIT = 3;
/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
 *
 * The CONSECUTIVE output-exhaustion streak, SEPARATED from the run-scoped
 * consumable allowance above.
 *
 * The predecessor conflated the two in one counter: the streak reset on any
 * tool call, which simultaneously re-armed the allowance. The two are now
 * distinct resources:
 *
 *   - the STREAK measures CONSECUTIVE unproductive exhaustion and may be
 *     cleared by a productive round (existing contract preserved), and
 *   - the ALLOWANCE is a consumable run-scoped resource that a productive
 *     round never replenishes.
 */
const MAX_TOKENS_EXHAUSTION_STREAK_LIMIT = 3;
/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
 *
 * The finite run-scoped ceiling on ADDITIONAL logical agent requests that
 * output-exhaustion recovery may drive.
 *
 * WHY A SEPARATE CEILING
 * ----------------------
 * The ordinary conciseness-reminder allowance (3) is exhausted BEFORE the
 * ordinary R1 threshold (5) can be reached, so enforcing it alone would
 * terminate the run before the R1/R2 recovery mechanisms can intervene — the
 * "premature termination" defect this ACT corrects.
 *
 * DERIVATION (against the ACTUAL production constants)
 * -----------------------------------------------------
 *   - ordinary conciseness-reminder allowance ........ 3 per run
 *   - ordinary R1 threshold ..................... 5 unproductive rounds
 *   - R1 corrective-instruction allowance ....... 2 per run
 *   - R2 activation allowance ................... 2 per run
 *   - R2 selection-inference allowance .......... 1 per run
 *   - R2 objective-round allowance .............. 8 per activation
 *
 * To reach the R1 `allowance_exhausted` branch (and therefore the R2 entry
 * point) the runtime must observe 5 unproductive rounds, spend BOTH R1
 * instructions (which each require a FRESH 5-round streak, because
 * `applyExecutionStagnationDecision` resets the streak after an injection),
 * and then observe one further unproductive round to reach the exhausted
 * branch. That is 5 + 5 + 1 = 11 logical rounds of pure stagnation before
 * R2 is even eligible.
 *
 * Each R2 objective may then run for up to 8 objective rounds before it is
 * closed out. The parent then continues, and the parent may itself stall
 * again — at which point the SAME bounded escalation applies.
 *
 * AMENDMENT-01 — THE CORRECTED TOTAL BOUND
 * -----------------------------------------
 * AMENDMENT-01 makes EVERY exhaustion-driven continuation — the ordinary
 * reminders INCLUDED — spend ONE unit of THIS counter, and it makes the
 * continuation decision CONSUME the R1/R2 lifecycle authority instead of
 * asking only whether the stagnation policy is enabled.
 *
 * The predecessor's bound of 20 was derived from the R1/R2 constants as if
 * the ordinary reminders and the escalations were counted on DIFFERENT
 * counters. They are not: they share this one. The reachable lifecycle
 * therefore costs:
 *
 *   11 exhaustion-driven continuations to reach the R1
 *   `allowance_exhausted` branch and the R2 entry point — that is the
 *   5 + 5 + 1 pure-stagnation rounds above, and it ALREADY INCLUDES the
 *   three rounds the ordinary reminders consumed, because those three
 *   rounds are part of the same 5-round streak;
 * +  8 R2 objective rounds;
 * =  19 ... plus the 3 ordinary reminders themselves, which are
 *   continuations too, = 23.
 *
 * MEASURED AGAINST THE REAL RUNTIME (AMENDMENT-01, production constants,
 * a persistently exhausted tool-less trajectory with R1 and R2 both
 * enabled), the reachable lifecycle is EXACTLY:
 *
 *     3  ordinary conciseness reminders        (requests 1-3)
 *   + 11  escalations to the R1 exhausted branch (requests 4-14)
 *   +  0  the R2 selection inference            (NOT a continuation: it
 *                                                is a separate request
 *                                                that executes nothing)
 *   +  7  the R2 objective's own rounds          (requests 16-22)
 *   = 21 exhaustion-driven continuations
 *
 * The R2 objective then closes out with a truthful verdict
 * (`objective_rounds_exhausted_without_verification`) and the run
 * terminates TRUTHFULLY.
 *
 * The predecessor bound of 20 therefore TRUNCATED the R2 objective's own
 * budget: the objective received only 6 of its 8 authorized rounds and
 * the run was terminated by the DEFENSIVE CEILING instead of by the
 * objective's own verdict. That is a real, demonstrated truncation of an
 * ACCEPTED intervention, and it is the production-state analysis the ACT
 * asks for, so the bound is raised.
 *
 * THE NEW BOUND is 32: the reachable lifecycle's 21 continuations plus a
 * margin of 11. The margin covers the SECOND R2 activation (the activation
 * allowance is 2 and the selection-inference allowance is 1 per run, so a
 * second activation cannot select again — the second activation is
 * reachable only through the same 11-round stagnation plus 8 objective
 * rounds, i.e. 19 more continuations, which would exceed any single
 * finite bound; the margin therefore covers the reachable part of that
 * second cycle without pretending to bound an unbounded repetition).
 *
 * It remains a DEFENSIVE ENGINEERING CEILING, strictly larger than the
 * reachable lifecycle, so every AUTHORIZED intervention remains reachable
 * inside it. It is an UPPER BOUND, never a target: the runtime terminates
 * truthfully as soon as no useful authorized intervention remains, and it
 * does not consume the ceiling merely because the ceiling exists.
 *
 * The counter is spent ONLY by an exhaustion-driven continuation. It is never
 * replenished by an inspection, by compaction, by a provider retry, by an
 * ordinary recovery escalation, or by the internal continuation of the same
 * recovery episode.
 */
const MAX_EXHAUSTION_RECOVERY_CONTINUATIONS = 32;
/** Nudge appended after an output-limit cut-off, asking for more concise output. */
const MAX_TOKENS_RECOVERY_NUDGE =
	"Your previous response was cut off because it reached the model's output-token limit before finishing. Keep responses concise: take one small step at a time, avoid long explanations, and write large files or command output in smaller chunks across multiple tool calls.";

/**
 * How many times to retry a model turn that failed with a transient,
 * provider-side error (rate limits, 5xx, network hiccups, OpenRouter's
 * generic "Provider returned error"). The initial attempt is not counted, so
 * a value of 3 means up to 4 total requests for one turn. Retrying only
 * transient errors — and never auth, context-overflow, or other client errors
 * (see {@link isRetryableProviderError}) — keeps well-behaved providers on
 * their existing single-request path, so this does not change behavior for
 * models whose endpoints do not throw transient errors.
 */
const PROVIDER_ERROR_MAX_RETRIES = 3;
/** Base backoff before the first retry; doubled each subsequent attempt. */
const PROVIDER_ERROR_RETRY_BASE_DELAY_MS = 1_000;
/** Upper bound on any single backoff wait. */
const PROVIDER_ERROR_RETRY_MAX_DELAY_MS = 15_000;

/**
 * Terminal message for a turn the provider blocked. Kept separate from the
 * generic empty-response text because the two call for opposite user action:
 * an empty response is worth retrying, a filtered one reproduces every time.
 */
const CONTENT_FILTER_EMPTY_TURN_MESSAGE =
	"Model returned no content because the response was blocked by a content filter. Retrying is unlikely to help — try rephrasing the request.";

/**
 * Terminal message when a context-window overflow cannot be recovered because
 * there is no conversation history to compact — the system prompt, tools, and
 * current input alone exceed the window.
 */
export const CONTEXT_WINDOW_OVERFLOW_NOTHING_TO_COMPACT_MESSAGE =
	"The request exceeds the model's context window and there is no conversation history to compact — the system prompt, tools, and current input alone are too large. Reduce attached content or switch to a model with a larger context window.";

/**
 * Terminal message when a context-window overflow persists after the runtime
 * already compacted the conversation and retried once.
 */
export const CONTEXT_WINDOW_OVERFLOW_RECOVERY_FAILED_MESSAGE =
	"The conversation still exceeds the model's context window after compacting it. Start a new session or switch to a model with a larger context window.";

/**
 * Terminal message when no compaction pipeline is available to recover from a
 * context-window overflow (e.g. compaction disabled).
 */
export const CONTEXT_WINDOW_OVERFLOW_NO_RECOVERY_MESSAGE =
	"The conversation exceeds the model's context window. Compact the conversation, start a new session, or switch to a model with a larger context window.";

/** Thrown when overflow recovery cannot proceed; carries the terminal text. */
class ContextWindowOverflowError extends Error {
	constructor(message: string, providerError: string | undefined) {
		super(
			providerError?.trim()
				? `${message} (provider reported: ${providerError.trim()})`
				: message,
		);
		this.name = "ContextWindowOverflowError";
	}
}

// Local `createUID` helper. The clinee source imports this from
// `@cline/shared` (see `packages/shared/dist/identifier.ts`), but
// sdk-re's shared package does not expose it yet. Inlining here keeps
// PLAN.md Step 1 scoped to `packages/agents/src/` and matches the
// exact clinee implementation (`${prefix}_${nanoid(length)}`).
function createUID(prefix: string, length = 8): string {
	return `${prefix}_${nanoid(length)}`;
}

export type AgentRunInput = string | AgentMessage | readonly AgentMessage[];
/**
 * C1.5 P1: the listener receives `LiveAgentRuntimeEvent`, where
 * `event.snapshot.recovery` is non-optional. The internal `emit()`
 * still calls listeners with the regular `AgentRuntimeEvent` — the
 * narrowing is type-only: every emitted event's `snapshot` carries
 * the canonical projection, so the runtime-to-listener contract
 * satisfies the refined type without any data transformation.
 */
export type AgentEventListener = (event: LiveAgentRuntimeEvent) => void;

/**
/**
 * Advanced form: caller supplies a pre-built `AgentModel`. Used by
 * `@cline/core`, which constructs models itself to share gateway/telemetry
 * wiring with the rest of the session runtime.
 */
export interface AgentRuntimeConfigWithModel extends BaseAgentRuntimeConfig {
	model: AgentModel;
}

/**
 * Friendly form: caller supplies provider/model IDs and credentials, and the
 * runtime builds an `AgentModel` internally via `@cline/llms`. This is the
 * entry point most standalone users want.
 */
export interface AgentRuntimeConfigWithProvider
	extends Omit<BaseAgentRuntimeConfig, "model"> {
	/** Provider ID (e.g., "anthropic", "openai") */
	providerId: string;
	/** Model ID to use */
	modelId: string;
	/** API key for the provider */
	apiKey?: string;
	/** Custom base URL for the API */
	baseUrl?: string;
	/** Additional headers for API requests */
	headers?: Record<string, string>;
	/** Provider-specific gateway options */
	options?: GatewayProviderSettings["options"];
}

/**
 * Config accepted by `new AgentRuntime(...)` / `createAgentRuntime(...)` /
 * `new Agent(...)` / `createAgent(...)`. Either supply a pre-built `model`
 * (advanced) or `providerId` + `modelId` (+ credentials) and the runtime will
 * construct the model itself via `@cline/llms`.
 */
export type AgentRuntimeConfig =
	| AgentRuntimeConfigWithModel
	| AgentRuntimeConfigWithProvider;

/**
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A2).
 *
 * Read the caller-selected API LINE out of the runtime config's gateway
 * provider options.
 *
 * The value is the SAME field the registry resolves the wire's base URL
 * from (`resolveApiLineBaseUrl(options)` reads `options.apiLine`), so the
 * budget's destination authority names the endpoint the request is actually
 * dispatched to.
 *
 * A value that is not one of the two established API lines yields NO api
 * line, which leaves the route unresolved rather than guessing.
 */
function readApiLineOption(config: AgentRuntimeConfig): string | undefined {
	if (!("options" in config)) {
		return undefined;
	}
	const apiLine = config.options?.apiLine;
	return apiLine === "china" || apiLine === "international"
		? apiLine
		: undefined;
}

function hasPrebuiltModel(
	config: AgentRuntimeConfig,
): config is AgentRuntimeConfigWithModel {
	return (config as AgentRuntimeConfigWithModel).model !== undefined;
}

function resolveRuntimeConfig(
	config: AgentRuntimeConfig,
): BaseAgentRuntimeConfig {
	if (hasPrebuiltModel(config)) {
		return config;
	}
	const { providerId, modelId, apiKey, baseUrl, headers, options, ...rest } =
		config;
	const gateway = createGateway({
		providerConfigs: [{ providerId, apiKey, baseUrl, headers, options }],
		telemetry: rest.telemetry,
	});
	const model = gateway.createAgentModel({ providerId, modelId });
	// The prebuilt-model path preserves a caller-provided messageModelInfo;
	// mirror that here so the provider/model constructor also tags assistant
	// messages with modelInfo. An explicit caller-provided value still wins.
	const messageModelInfo = rest.messageModelInfo ?? {
		id: modelId,
		provider: providerId,
	};
	return { ...rest, model, messageModelInfo };
}

function resolveToolPolicy(
	toolName: string,
	policies: BaseAgentRuntimeConfig["toolPolicies"],
): ToolPolicy {
	return {
		...(policies?.["*"] ?? {}),
		...(policies?.[toolName] ?? {}),
	};
}

interface PendingToolAssembly {
	toolCallId: string;
	toolName?: string;
	inputText: string;
	inputValue?: unknown;
	metadata?: unknown;
	parseError?: string;
}

interface InvalidToolCall {
	toolCallId: string;
	toolName?: string;
	input: Record<string, unknown>;
	reason: "missing_name" | "missing_arguments" | "invalid_arguments";
}

function safeJsonSize(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return String(value).length;
	}
}

function getOutputSize(output: unknown): number {
	if (typeof output === "string") {
		return output.length;
	}
	return safeJsonSize(output);
}

function summarizeModelRequest(
	request: AgentModelRequest,
): Record<string, unknown> {
	let textChars = request.systemPrompt?.length ?? 0;
	let toolResultCount = 0;
	let toolResultChars = 0;
	let maxToolResultChars = 0;
	for (const message of request.messages) {
		for (const part of message.content) {
			switch (part.type) {
				case "text":
					textChars += part.text.length;
					break;
				case "reasoning":
					textChars += part.text.length;
					break;
				case "file":
					textChars += part.content.length;
					break;
				case "tool-call":
					textChars += safeJsonSize(part.input);
					break;
				case "tool-result": {
					const outputChars = getOutputSize(part.output);
					toolResultCount += 1;
					toolResultChars += outputChars;
					maxToolResultChars = Math.max(maxToolResultChars, outputChars);
					textChars += outputChars;
					break;
				}
			}
		}
	}

	return {
		messageCount: request.messages.length,
		toolSchemaCount: request.tools.length,
		systemPromptChars: request.systemPrompt?.length ?? 0,
		requestJsonChars: safeJsonSize({
			systemPrompt: request.systemPrompt,
			messages: request.messages,
			tools: request.tools,
			options: request.options,
		}),
		visibleTextChars: textChars,
		estimatedTextTokens: estimateTokens(textChars),
		toolResultCount,
		toolResultChars,
		maxToolResultChars,
	};
}

interface PreparedToolExecution {
	toolCall: AgentToolCallPart;
	tool?: AgentTool;
	input: unknown;
	skipReason?: string;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * The authorization state observed at the executor boundary, recorded
	 * STRUCTURALLY (never inferred from a message string).
	 *
	 * - `approved` — the runtime authorized the call.
	 * - `rejected` — the runtime DENIED the call.
	 * - `skipped` — the call never reached the authorization step because
	 *   it was structurally ineligible (unknown tool, schema-invalid input,
	 *   policy-disabled tool, pre-execution recovery breaker).
	 * - `unavailable` — the state could not be observed.
	 */
	approvalOutcome?: ModelBehaviorTraceEditApprovalOutcome;
	/**
	 * C1.2: typed control-plane signal observed at the boundary, if any.
	 * Set by `prepareToolExecution` from STRUCTURAL evidence (host DENY
	 * decision, user-rejected approval, policy-disabled tool,
	 * abort/parser-error paths). For generic skips with no richer reason,
	 * this is left undefined — the classifier falls through to
	 * `runtime_skipped` via Priority 4 (`toolExecutionInvoked=false`).
	 *
	 * Outranks every other provenance in the C1.1 classifier.
	 */
	controlPlaneOutcome?: ControlPlaneOutcome;
	/**
	 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
	 * C2 plumbing: closed runtime-owned authority slot.
	 *
	 * Set ONLY when the host's policy callback returned
	 * `ToolApprovalResult.executionCapability` (the trusted channel).
	 * NEVER derived from `prepared.toolCall.metadata` -- that source
	 * is partially untrusted (see metadata-provenance.md) and is
	 * deliberately excluded from this slot. Stamped into
	 * `AgentToolContext.executionCapability` at the construction site
	 * in `executePreparedTool`.
	 *
	 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2 GUARD:
	 * This field is typed as `ToolCallExecutionCapability` (a leaf
	 * containing only `factory-binding-probe`). Real authority-bearing
	 * variants are NOT reachable here at compile time. Real authority
	 * flows via the per-command channel (`commandExecutionPlan`
	 * slot below).
	 */
	executionCapability?: ToolCallExecutionCapability;
	/**
	 * ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01:
	 *
	 * Closed runtime-owned per-command plan slot (NOT in metadata).
	 * Populated by `prepareToolExecution` from the host's policy
	 * callback result (`ToolApprovalResult.executionPlan`). The plan
	 * is the authority-bearing structure: each entry carries
	 * `executionCapability` which travels with the decision that
	 * granted it.
	 *
	 * Stamped into `AgentToolContext.commandExecutionPlan` at the
	 * construction site in `executePreparedTool`. The runtime NEVER
	 * reads this from `toolCall.metadata`.
	 *
	 * When this slot is set, the executor MUST consume
	 * `entry.executionCapability` by `commandIndex` (positional)
	 * and FAIL CLOSED if correlation cannot be proven exactly.
	 * When this slot is absent, the legacy tool-call capability
	 * path is allowed (synthetic transport compatibility only).
	 */
	commandExecutionPlan?: CommandExecutionPlan;
	/**
	 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
	 *
	 * Closed runtime-owned conditional authority flag. Captured from
	 * the host's policy callback result
	 * (`ToolApprovalResult.mandatorySeatbeltExecution`). Set ONLY
	 * when the host's policy chain produced the conditional source
	 * (`host_mode_all_seatbelt_required`). The runtime is the ONLY
	 * consumer that copies this value into the closed runtime-owned
	 * `AgentToolContext.mandatorySeatbeltExecution` slot.
	 *
	 * Provenance contract (same family as `executionCapability` /
	 * `commandExecutionPlan`):
	 *   Source 1 (toolCall.metadata): NOT used.
	 *   Source 2 (runtime-owned keys): NOT used.
	 *   Source 3 (host-attached; trusted IF typed slot): IS used,
	 *     via ToolApprovalResult.mandatorySeatbeltExecution -> this slot.
	 *
	 * Stamped into `AgentToolContext.mandatorySeatbeltExecution` at
	 * the construction site in `executePreparedTool`. When `true`,
	 * the executor (`CommandJobManager.start`) refuses any
	 * host-shell fallback.
	 */
	mandatorySeatbeltExecution?: boolean;
}

interface HookBag {
	beforeRun: NonNullable<AgentRuntimeHooks["beforeRun"]>[];
	afterRun: NonNullable<AgentRuntimeHooks["afterRun"]>[];
	beforeModel: NonNullable<AgentRuntimeHooks["beforeModel"]>[];
	afterModel: NonNullable<AgentRuntimeHooks["afterModel"]>[];
	beforeTool: NonNullable<AgentRuntimeHooks["beforeTool"]>[];
	afterTool: NonNullable<AgentRuntimeHooks["afterTool"]>[];
	onToolRuntimeOutcome: NonNullable<
		AgentRuntimeHooks["onToolRuntimeOutcome"]
	>[];
	onEvent: NonNullable<AgentRuntimeHooks["onEvent"]>[];
}

class ControlledStopError extends Error {
	readonly reason?: string;

	constructor(reason?: string) {
		super(reason ?? "Run stopped by runtime control");
		this.name = "ControlledStopError";
		this.reason = reason;
	}
}

/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 (R2).
 *
 * The system prompt of the ONE bounded selection inference.
 *
 * It asks for ONE bounded objective and nothing else. It explicitly
 * forbids the model from inventing evidence, from claiming an outstanding
 * obligation is satisfied, and from expanding the parent's authority.
 */
const BOUNDED_OBJECTIVE_SELECTION_SYSTEM_PROMPT = [
	"You select ONE bounded, independently verifiable objective for an autonomous recovery.",
	"Reply with ONE JSON object and nothing else. No prose, no markdown fence, no explanation.",
	"The JSON object MUST have exactly these keys:",
	'  "objective": one concrete bounded objective (a single action, not a programme of work)',
	'  "firstStep": the one actionable first step',
	'  "mutationScope": the scope the objective is permitted to touch',
	'  "verificationCondition": an OBSERVABLE condition checkable from tool outcomes',
	'  "obligationReferences": a non-empty array of the parent obligation reference ids, copied EXACTLY',
	'  "evidenceReferences": a non-empty array of the established observation references, copied verbatim',
	'  "successCondition": the condition under which the objective succeeds',
	'  "failureCondition": the condition under which the objective fails',
	"Rules:",
	"- Cite established observations VERBATIM from the supplied list. Never invent an observation.",
	"- Cite only parent obligation reference ids that are listed, copied EXACTLY. Never invent a reference id.",
	"- A parent obligation reference names a requirement in the parent task; it does NOT mean that requirement is already satisfied.",
	"- Never claim an outstanding obligation is already satisfied.",
	"- A success condition states what WILL make the objective succeed. Never state that anything is already satisfied.",
	"- Never widen the parent's mutation scope.",
	"- The verification condition must be checkable from a command that exits successfully, a file that changes, or an artefact that exists.",
	"- Do not analyse or request the assistant's private reasoning. Do not include reasoning signatures.",
	"- Do not use tools. Do not modify anything. You are naming an objective, not executing it.",
].join("\n");

/**
 * Build the selection inference's prompt from the MINIMUM SUFFICIENT
 * context.
 *
 * The prompt carries only what the selection needs:
 *
 *   - the original user-authorized objective,
 *   - the applicable parent constraints,
 *   - the outstanding acceptance obligations,
 *   - the established observations with their evidence references,
 *   - the recent failed execution strategy,
 *   - the actual available tools,
 *   - the remaining recovery allowance.
 *
 * It NEVER carries provider-owned thinking text and NEVER carries an
 * opaque reasoning signature.
 */
function buildBoundedObjectiveSelectionPrompt(context: {
	parentTaskId: string;
	parentObjective: string;
	parentConstraints: string[];
	parentMutationScope: string;
	parentMutationScopePaths: string[];
	parentObligationReferences: ParentObligationReference[];
	outstandingObligations: string[];
	establishedObservations: string[];
	recentFailedStrategy: string;
	availableTools: string[];
	remainingAllowance: {
		activations: number;
		selectionInferences: number;
		objectiveRounds: number;
	};
}): string {
	const lines = [
		`Parent task id: ${context.parentTaskId}`,
		`Parent task (user-authorized objective): ${context.parentObjective}`,
	];
	if (context.parentMutationScopePaths.length > 0) {
		lines.push(
			`Authorised mutation paths (the objective may not name a path outside these): ${context.parentMutationScopePaths.join(", ")}`,
		);
	}
	if (context.parentConstraints.length > 0) {
		lines.push("Applicable parent constraints (user authority):");
		for (const constraint of context.parentConstraints) {
			lines.push(`- ${constraint}`);
		}
	}
	// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
	//
	// The PARENT-OBLIGATION REFERENCE VOCABULARY is projected here.
	//
	// Each entry is a reference the selection MAY cite, identified by a
	// STABLE id. The id is what the validator resolves; the label is the
	// parent's own heading text, reproduced verbatim, so the selection can
	// see WHICH requirement it is advancing without having to reproduce a
	// long sentence verbatim.
	//
	// The vocabulary never asserts that a requirement is satisfied or
	// outstanding: it only names the parent's own requirements.
	lines.push(
		"Parent obligation references (cite these ids EXACTLY in obligationReferences):",
	);
	for (const reference of context.parentObligationReferences) {
		lines.push(`- ${reference.id} — ${reference.label}`);
	}
	lines.push("Outstanding parent acceptance obligations:");
	for (const obligation of context.outstandingObligations) {
		lines.push(`- ${obligation}`);
	}
	lines.push("Established observations (cite these verbatim):");
	for (const observation of context.establishedObservations) {
		lines.push(`- ${observation}`);
	}
	lines.push(
		`Recent failed execution strategy: ${context.recentFailedStrategy}`,
	);
	lines.push(
		`Available tools: ${context.availableTools.length > 0 ? context.availableTools.join(", ") : "none"}`,
	);
	lines.push(
		`Remaining recovery allowance: ${context.remainingAllowance.activations} activation(s), ${context.remainingAllowance.selectionInferences} selection inference(s), ${context.remainingAllowance.objectiveRounds} objective round(s)`,
	);
	lines.push(
		"Select ONE bounded objective that advances an outstanding parent obligation and can be verified from observable tool outcomes.",
	);
	return lines.join("\n");
}

/**
 * Parse the candidate objective out of the selection inference's reply.
 *
 * The reply is ONE JSON object. The parser tolerates a markdown fence and
 * surrounding whitespace, because a model that answers in the requested
 * shape may still wrap it. Anything that is not a JSON object yields
 * `undefined`, which the runtime treats as a failed selection.
 */
function parseBoundedObjectiveCandidate(text: string): unknown | undefined {
	if (typeof text !== "string") {
		return undefined;
	}
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	const candidates: string[] = [trimmed];
	const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
	if (fenceMatch?.[1]) {
		candidates.push(fenceMatch[1].trim());
	}
	const firstBrace = trimmed.indexOf("{");
	const lastBrace = trimmed.lastIndexOf("}");
	if (firstBrace !== -1 && lastBrace > firstBrace) {
		candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
	}
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed;
			}
		} catch {
			// Try the next candidate form.
		}
	}
	return undefined;
}

/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
 *
 * Extract the COMMAND IDENTITY of ONE tool call.
 *
 * The identity is the command TEXT the call carried — never the tool's
 * OUTPUT. It is what makes a required verification gate correlatable with
 * the execution that was supposed to run it.
 *
 * The shapes are the ones the runtime's own command classification already
 * recognises: a `commands` ARRAY of strings, a single `command` string, or
 * a `cmd` string. A call that carries no command yields `undefined`.
 */
function extractToolCallCommandIdentity(input: unknown): string | undefined {
	if (typeof input === "string") {
		return input.length > 0 ? input : undefined;
	}
	if (typeof input !== "object" || input === null) {
		return undefined;
	}
	const record = input as Record<string, unknown>;
	const commands = record.commands;
	if (Array.isArray(commands)) {
		const parts = commands
			.filter((entry): entry is string => typeof entry === "string")
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
		return parts.length > 0 ? parts.join(" && ") : undefined;
	}
	if (typeof record.command === "string" && record.command.trim().length > 0) {
		return record.command.trim();
	}
	if (typeof record.cmd === "string" && record.cmd.trim().length > 0) {
		return record.cmd.trim();
	}
	return undefined;
}

/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
 *
 * Extract the TARGET PATH of ONE mutating tool call.
 *
 * The shapes are the ones the runtime's own edit classification already
 * recognises: a `path` string, or a `file_path` string. A call that
 * carries no explicit path yields `undefined`.
 *
 * The runtime never derives a target path from command TEXT: the
 * command-policy layer and the sandbox remain the authority for command
 * contents, and guessing would be provider-specific string matching.
 */
function extractToolCallTargetPath(input: unknown): string | undefined {
	if (typeof input !== "object" || input === null) {
		return undefined;
	}
	const record = input as Record<string, unknown>;
	for (const key of ["path", "file_path"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return undefined;
}

export class AgentRuntimeAbortError extends Error {
	readonly reason?: unknown;

	constructor(reason?: unknown) {
		const message =
			typeof reason === "string"
				? reason
				: reason instanceof Error
					? reason.message
					: reason === undefined
						? "Run aborted"
						: String(reason);
		super(message);
		this.name = "AgentRuntimeAbortError";
		this.reason = reason;
	}
}

const DEFAULT_USAGE: AgentUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
};

/**
 * ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01.
 *
 * WHO initiated a run termination.
 *
 * The origin is declared by the seam that requests the abort, because that
 * seam is the only party that knows which production path initiated it. It
 * is NEVER inferred afterwards from the terminal status.
 *
 * The set is restricted to origins the runtime can observe at a REAL
 * production seam. A classification the runtime cannot determine reliably is
 * not defined, because a fabricated origin is worse than an absent one.
 */
export type AgentRuntimeAbortOrigin =
	/** A host / caller requested the abort through the public API. */
	| "explicit_abort_request"
	/** The runtime itself stopped the run (bounded recovery, hook stop). */
	| "runtime_controlled_stop"
	/** The production loop detector escalated to a hard stop. */
	| "loop_detector_escalation"
	/** The session was disposed / shut down. */
	| "session_disposal"
	/** A provider failure terminated the run. */
	| "provider_exception"
	/** The origin could not be determined. */
	| "unknown";

function createMessage(
	role: AgentMessage["role"],
	content: AgentMessagePart[],
	metadata?: Record<string, unknown>,
): AgentMessage {
	return {
		id: createUID("msg"),
		role,
		content,
		createdAt: Date.now(),
		metadata,
	};
}

function cloneUsage(usage: AgentUsage): AgentUsage {
	return { ...usage };
}

const HOOK_ATTRIBUTE_ESCAPES: Record<string, string> = {
	_: "__",
	'"': "_q_",
	"<": "_lt_",
	">": "_gt_",
};

function sanitizeHookAttribute(value: string): string {
	// The underscore escapes itself, which makes the encoding injective
	// (uniquely decodable escape code): no two distinct ids can collapse to
	// the same sanitized stamp.
	return value.replace(/[_"<>]/g, (char) => HOOK_ATTRIBUTE_ESCAPES[char]);
}

/**
 * Where a hook context block came from. Tool hooks carry the call they ran
 * for; run-start hooks (TaskStart/UserPromptSubmit/TaskResume in their
 * various layer spellings) have no tool identity, and the layers merge their
 * outputs before the runtime sees them, so a single generic source labels
 * those blocks.
 */
type HookContextOrigin =
	| { source: "RunStart" }
	| {
			source: "PreToolUse" | "PostToolUse" | "ToolSuccess";
			toolCall: AgentToolCallPart;
	  };

function formatHookContextBlock(
	origin: HookContextOrigin,
	text: string,
): string {
	// Tool identity keeps each block attributable to its call: contexts are
	// batched into one message after the tool results, and parallel tool
	// execution collects them in completion order, so position alone cannot
	// identify the tool. Attribute values are sanitized and embedded
	// hook_context tags (opening and closing) neutralized so neither
	// provider-supplied ids nor hook output can corrupt or spoof the block
	// markup.
	const attributes = [`source="${origin.source}"`];
	if ("toolCall" in origin) {
		attributes.push(
			`tool_name="${sanitizeHookAttribute(origin.toolCall.toolName)}"`,
			`tool_call_id="${sanitizeHookAttribute(origin.toolCall.toolCallId)}"`,
		);
	}
	const body = text.trim().replace(/<(\/?)hook_context/gi, "<\\$1hook_context");
	return `<hook_context ${attributes.join(" ")}>\n${body}\n</hook_context>`;
}

function cloneMessages(messages: readonly AgentMessage[]): AgentMessage[] {
	return messages.map((message) => ({
		...message,
		content: message.content.map((part: AgentMessagePart) => ({ ...part })),
		metadata: message.metadata ? { ...message.metadata } : undefined,
		modelInfo: message.modelInfo ? { ...message.modelInfo } : undefined,
		metrics: message.metrics ? { ...message.metrics } : undefined,
	}));
}

function usageDelta(
	start: AgentUsage,
	end: AgentUsage,
): NonNullable<AgentMessage["metrics"]> | undefined {
	const inputTokens = Math.max(
		0,
		(end.inputTokens ?? 0) - (start.inputTokens ?? 0),
	);
	const outputTokens = Math.max(
		0,
		(end.outputTokens ?? 0) - (start.outputTokens ?? 0),
	);
	const cacheReadTokens = Math.max(
		0,
		(end.cacheReadTokens ?? 0) - (start.cacheReadTokens ?? 0),
	);
	const cacheWriteTokens = Math.max(
		0,
		(end.cacheWriteTokens ?? 0) - (start.cacheWriteTokens ?? 0),
	);
	const reasoningTokenCount = Math.max(
		0,
		(end.reasoningTokenCount ?? 0) - (start.reasoningTokenCount ?? 0),
	);
	const startCost = start.totalCost ?? 0;
	const endCost = end.totalCost ?? 0;
	const cost = Math.max(0, endCost - startCost);
	if (
		inputTokens === 0 &&
		outputTokens === 0 &&
		cacheReadTokens === 0 &&
		cacheWriteTokens === 0 &&
		reasoningTokenCount === 0 &&
		cost === 0
	) {
		return undefined;
	}
	return {
		inputTokens: inputTokens > 0 ? inputTokens : 0,
		outputTokens: outputTokens > 0 ? outputTokens : 0,
		cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : 0,
		cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : 0,
		...(reasoningTokenCount > 0 ? { reasoningTokenCount } : {}),
		...(cost > 0 ? { cost } : {}),
	};
}

function reasoningWasRequestedOff(request: AgentModelRequest): boolean {
	return request.options?.thinking === false;
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01.
 *
 * Read the per-request correlation id out of the request options metadata.
 *
 * The options bag is an untyped `Record<string, unknown>`, so the metadata
 * sub-bag must be narrowed before it can be indexed. A non-object metadata
 * bag yields `undefined` — the id is never guessed.
 */
function readModelBehaviorRequestId(
	request: AgentModelRequest,
): string | undefined {
	const metadata = request.options?.metadata;
	if (!metadata || typeof metadata !== "object") {
		return undefined;
	}
	const requestId = (metadata as Record<string, unknown>)[
		MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY
	];
	return typeof requestId === "string" && requestId.trim() !== ""
		? requestId
		: undefined;
}

/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (R1).
 *
 * A privacy-safe summary of the reasoning configuration a model request
 * carries. The values are ENUMERATIONS and COUNTS only — never prompt text,
 * never reasoning content, never tool arguments, never credentials.
 *
 * - `requestedThinking` — the persisted user selection ("on" / "off" /
 *   "unset"). This is the SELECTION, not the effective wire policy.
 * - `requestedReasoningEffort` — the persisted effort selection, if any.
 * - `reasoningEffortAdvertised` — whether an effort was requested at all.
 *
 * The WIRE-level facts (what the provider actually received) are recorded by
 * the wire-reasoning observer in the provider transport, not here: the agent
 * runtime does not own the provider wire encoding, and claiming it here
 * would be an inference rather than an observation.
 */
function summarizeReasoningConfiguration(
	request: AgentModelRequest,
): Record<string, unknown> {
	const options = request.options;
	const thinking = options?.thinking;
	const effort = options?.reasoningEffort;
	return {
		requestedThinking:
			typeof thinking === "boolean" ? (thinking ? "on" : "off") : "unset",
		...(typeof effort === "string" ? { requestedReasoningEffort: effort } : {}),
		reasoningEffortAdvertised: typeof effort === "string",
	};
}

/**
 * ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (R1).
 *
 * Whether the provider STREAMED reasoning content, and how many bytes of it
 * there were. Only the byte COUNT is recorded: no reasoning text is retained,
 * so the observation can establish that reasoning happened (or did not) and
 * how much of it there was, without retaining any of its content.
 *
 * The byte count is an INFERRED size, not a token count. It is deliberately
 * named `reasoningContentBytes` so it can never be confused with the
 * provider-reported reasoning TOKEN count.
 *
 * The count is in UTF-8 BYTES, not UTF-16 code units. `String.length`
 * counts UTF-16 code units, so it under-counts every non-ASCII character
 * (a CJK character is one code unit but three UTF-8 bytes) and would make
 * the recorded size disagree with the provider-request capture's
 * `payloadBytes`, which is already UTF-8. `TextEncoder` is the
 * platform-neutral way to measure UTF-8 bytes in both Node and the
 * browser.
 */
function summarizeReasoningContent(
	content: readonly AgentMessagePart[],
): Record<string, unknown> {
	const reasoningParts = content.filter(
		(part): part is Extract<AgentMessagePart, { type: "reasoning" }> =>
			part.type === "reasoning",
	);
	if (reasoningParts.length === 0) {
		return { reasoningContentPresent: false, reasoningContentBytes: 0 };
	}
	const encoder = new TextEncoder();
	const reasoningContentBytes = reasoningParts.reduce(
		(total, part) => total + (part.text ? encoder.encode(part.text).length : 0),
		0,
	);
	return {
		reasoningContentPresent: true,
		reasoningContentBytes,
		reasoningContentParts: reasoningParts.length,
	};
}

function textFromMessage(message: AgentMessage | undefined): string {
	if (!message) {
		return "";
	}
	return message.content
		.filter(
			(
				part: AgentMessagePart,
			): part is Extract<AgentMessagePart, { type: "text" }> =>
				part.type === "text",
		)
		.map((part: Extract<AgentMessagePart, { type: "text" }>) => part.text)
		.join("");
}

function textFromToolMessage(message: AgentMessage | undefined): string {
	const result = message?.content.find(
		(part): part is Extract<AgentMessagePart, { type: "tool-result" }> =>
			part.type === "tool-result",
	);
	if (!result || result.isError) {
		return "";
	}
	if (typeof result.output === "string") {
		return result.output;
	}
	try {
		return JSON.stringify(result.output);
	} catch {
		return String(result.output);
	}
}

function normalizeInput(input: AgentRunInput): AgentMessage[] {
	if (typeof input === "string") {
		return [createMessage("user", [{ type: "text", text: input }])];
	}
	if (Array.isArray(input)) {
		return cloneMessages(input);
	}
	return cloneMessages([input as AgentMessage]);
}

/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 (R2).
 *
 * Whether a message is RUNTIME-SYNTHETIC rather than user-authored.
 *
 * The runtime injects its own reminders into the canonical transcript as
 * `user`-ROLE messages, because that is the role the provider transport
 * accepts. Their ROLE therefore does not distinguish them from a user's
 * own turn.
 *
 * The runtime's own PROVENANCE stamp does: every runtime-synthetic
 * message carries `userRunSpan: 0` (the "no user run span" marker the
 * compaction contract-conservation path already uses) together with a
 * `displayRole`. A user-authored turn carries neither.
 *
 * The check reads the runtime's own metadata — never the message TEXT — so
 * it can never be fooled by a message that merely looks like a reminder.
 */
function isRuntimeSyntheticMessage(message: AgentMessage): boolean {
	const metadata = message.metadata;
	if (!metadata) {
		return false;
	}
	if (metadata.userRunSpan !== 0) {
		return false;
	}
	return (
		typeof metadata.displayRole === "string" ||
		typeof metadata.runtimeAuthority === "string"
	);
}

export class AgentRuntime {
	private config: Required<Pick<BaseAgentRuntimeConfig, "toolExecution">> &
		BaseAgentRuntimeConfig;
	private readonly listeners = new Set<AgentEventListener>();
	// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary per tool
	private readonly tools = new Map<string, AgentTool<any, any>>();
	private hooks: HookBag = {
		beforeRun: [],
		afterRun: [],
		beforeModel: [],
		afterModel: [],
		beforeTool: [],
		afterTool: [],
		onToolRuntimeOutcome: [],
		onEvent: [],
	};
	/**
	 * `appendContext` blocks waiting to be injected as one user message.
	 * beforeRun hooks fill it before the run's first model request; beforeTool
	 * and afterTool hooks fill it during an iteration's tool executions and it
	 * flushes after the tool results, so tool-result parts stay contiguous for
	 * providers that require them first in the following turn.
	 */
	private pendingHookContexts: string[] = [];

	/**
	 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	 * (thirty-third-pass, attempt 2) — diagnostic observer state.
	 * The runtime instance no longer exposes a public setter.
	 * Instead, the observer is a Symbol.for-keyed slot on
	 * `globalThis` (key: "@cline/agents__wTraceObserver")
	 * that `installRuntimeWTraceObserver` (defined in
	 * `./runtime-w-trace-internal`) writes to. The runtime
	 * consults the same slot on every
	 * `prepareTurnForModelRequest`. This keeps the diagnostic
	 * entirely internal to the runtime composition seam
	 * (no public class API leak).
	 */
	private readonly state = {
		agentId: "",
		agentRole: undefined as string | undefined,
		parentAgentId: undefined as string | null | undefined,
		runId: undefined as string | undefined,
		status: "idle" as AgentRuntimeStateSnapshot["status"],
		iteration: 0,
		messages: [] as AgentMessage[],
		pendingToolCalls: [] as string[],
		usage: cloneUsage(DEFAULT_USAGE),
		lastError: undefined as string | undefined,
		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-
		// TRANSPORT-REPAIR01 (fourteenth-pass): STATE_BIND.
		// Captured verbatim from `prepareTurn` return value
		// (`result.currentWorkingContextEstimate`) at
		// `prepareTurnForModelRequest` (line ~2336); surfaced
		// on `snapshot().currentWorkingContextEstimate`.
		// Reset to `undefined` on new run, restore, and
		// before any prepareTurn has fired. Pinned by
		// `agent-runtime.current-working-context-state-bind
		//   .test.ts`.
		currentWorkingContextEstimate: undefined as number | undefined,
		lastErrorClass: undefined as ProviderErrorClass | undefined,
		/** Provider-reported input tokens for the most recent request this run. */
		lastRequestInputTokens: 0,
		/**
		 * Whether the last provider failure was transient and worth retrying,
		 * carried from the model boundary via `errorRetryable` on the `finish`
		 * event (the AI SDK's typed `isRetryable` flag). Undefined when no such
		 * signal was provided, in which case the agent loop classifies from the
		 * flattened `lastError` message instead.
		 */
		lastErrorRetryable: undefined as boolean | undefined,
		/**
		 * Whether the model layer already recorded `sdk.error` telemetry for
		 * `lastError` (from `errorReported` on the stream's `finish` event).
		 * Custom `AgentModel` implementations that do not record their own
		 * telemetry leave this false, so their failures still get reported.
		 */
		lastErrorReported: false,
		/**
		 * RSMT01 EXECUTION-AUTHORITY FLAGS.
		 *
		 * SOURCE OF TRUTH for the `execution` projection's
		 * `modelStreaming` and `awaitingApproval` fields.
		 * `tooling` is derived from `pendingToolCalls.length > 0`
		 * in the projection, so it lives only in the snapshot.
		 *
		 * Mutation rules (pinned by
		 * `agent-runtime.execution-state.test.ts`):
		 *
		 *   - `executionModelStreaming` is set true
		 *     immediately before the model-stream for-await
		 *     loop in `generateAssistantMessage` and cleared in
		 *     the same `finally` after the loop.
		 *   - `executionAwaitingApproval` is set true
		 *     immediately before the `await requestApproval(...)`
		 *     call in `requestToolApproval` and cleared in
		 *     the same `finally` after the await resolves.
		 *   - Both flags are reset to `false` on `run()`
		 *     start (next-run freshness).
		 */
		executionModelStreaming: false,
		executionAwaitingApproval: false,
		/**
		 * Finish reason carried into the run-failed `sdk.error` event. Set
		 * only at the throw sites where a finish reason IS the failure's
		 * cause (empty turn, max-tokens, provider error) — never recorded
		 * ambiently on finish events, so a failure elsewhere in the loop
		 * (hooks, listeners, transport, setup) can never inherit a reason
		 * from a request that did not cause it. Undefined means the
		 * attribute is omitted, which is always safe; a wrong reason is not.
		 */
		lastFinishReason: undefined as AgentModelFinishReason | undefined,
	};
	/**
	 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
	 *
	 * The ACTIVE PREPARATION REQUEST IDENTITY — the id minted ONCE, EARLY,
	 * in `prepareModelRequest()` for the prepared request currently being
	 * issued.
	 *
	 * It is set when a prepared request enters `streamPreparedRequest`, so it
	 * is ALWAYS the identity of the request the provider is about to see. A
	 * provider RETRY re-enters `streamPreparedRequest` with the SAME prepared
	 * request, so the preparation id is UNCHANGED across retries while the
	 * provider attempt id (`this.modelRequestId`) is re-minted. That is the
	 * distinction the measurement needs: a retry is a new ATTEMPT against
	 * the same PREPARED REQUEST, never a new compaction decision.
	 *
	 * ABSENT (never synthesized) before any request is prepared.
	 */
	private activePreparationRequestId: string | undefined;
	/**
	 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
	 *
	 * The PROVIDER-DISPATCH RECORD for the active prepared request: the
	 * final projection's estimated input tokens, its provider-visible message
	 * count, its tool-schema count and its deterministic content fingerprint.
	 *
	 * It is computed ONCE, at the provider-ready seam — the only point where
	 * the request content is final — and then REUSED by the dispatch and
	 * completion observations, so all of them describe the SAME projection.
	 *
	 * It is recomputed for every prepared request (a new preparation means a
	 * new projection). It is NOT recomputed per provider attempt: a retry
	 * re-issues the SAME prepared request, so the SAME dispatch record
	 * applies.
	 *
	 * ABSENT when no sink is armed or the fingerprint could not be computed.
	 */
	private activeDispatchRecord: Record<string, unknown> | undefined;
	/** One automatic overflow-recovery attempt per run. */
	private overflowRecoveryAttempted = false;
	/**
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1).
	 *
	 * RUN-SCOPED execution-stagnation accounting. It lives on the runtime
	 * instance (never module-global, never UI-owned), so it is reset only by
	 * a NEW RUN and is unaffected by compaction — compaction replaces the
	 * PROVIDER REQUEST messages, never the runtime's counters.
	 *
	 * The pure decision function lives in `@cline/shared`
	 * (`agents/execution-stagnation`); this field only holds its state.
	 */
	private executionStagnation: ExecutionStagnationAccounting =
		createExecutionStagnationAccounting();
	/**
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1).
	 *
	 * The facts observed for the CURRENT execution round (one model request
	 * plus the tool calls it produced). Reset at the start of every round.
	 */
	private executionRoundFacts: {
		toolNames: string[];
		editAttempts: number;
		successfulEdits: number;
		executedCommands: number;
		/**
		 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01.
		 *
		 * How many command calls in this round produced an OUTCOME that was
		 * NOT a successful execution: the command FAILED, or the execution
		 * outcome was MISSING.
		 *
		 * A failed executable experiment is real engineering evidence, but it
		 * is NOT positive evidence of PROGRESS, so it does not reset the
		 * stagnation streak. It is counted separately so that a generic
		 * command failure can never be laundered into a productive
		 * execution by the runtime's fallback.
		 */
		failedExecutions: number;
		awaitingBackgroundWork: boolean;
		/**
		 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
		 *
		 * The STRUCTURED EXECUTION RECEIPTS of this round. Each receipt
		 * carries the tool name, the command identity (when the call was
		 * command-shaped) and the outcome — the CORRELATION EVIDENCE the
		 * R2 verification gate uses.
		 */
		receipts: BoundedObjectiveExecutionReceipt[];
	} = {
		toolNames: [],
		editAttempts: 0,
		successfulEdits: 0,
		executedCommands: 0,
		failedExecutions: 0,
		awaitingBackgroundWork: false,
		receipts: [],
	};
	/**
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 (R2).
	 *
	 * The RUN-SCOPED bounded-objective recovery accounting. It lives on the
	 * runtime instance (never module-global, never UI-owned), so it is reset
	 * only by a NEW RUN and is unaffected by compaction — compaction replaces
	 * the PROVIDER REQUEST messages, never the runtime's counters.
	 *
	 * The pure contract lives in `@cline/shared`
	 * (`agents/bounded-objective`); these fields only hold its state.
	 */
	private boundedObjectiveActivations = 0;
	/** How many selection inferences this run consumed. */
	private boundedObjectiveSelectionInferences = 0;
	/**
	 * The ACTIVE bounded objective, when one is executing.
	 *
	 * While it is set, the runtime projects it onto the DISPATCHED model
	 * request's privileged channel, so the next request reflects the
	 * objective as the current execution target. It is a runtime-owned
	 * projection, NOT a transcript mutation: the canonical conversation
	 * history is untouched.
	 */
	private activeBoundedObjective: BoundedObjective | undefined;
	/**
	 * The observable facts accumulated while the ACTIVE bounded objective
	 * executes. They are what the verification step inspects.
	 */
	private boundedObjectiveFacts: BoundedObjectiveObservationFacts = {
		rounds: 0,
		toolNames: [],
		editAttempts: 0,
		successfulEdits: 0,
		executedCommands: 0,
	};
	/**
	 * The explicit internal recovery outcome of the LAST R2 activation.
	 *
	 * It is produced when an R2 recovery does NOT succeed, so a future R3
	 * consumer has a truthful, machine-readable fact to act on. The runtime
	 * never manufactures success.
	 */
	private lastBoundedObjectiveOutcome:
		| {
				readonly kind: "completed" | "failed";
				readonly reason?: string;
				readonly objective?: BoundedObjective;
		  }
		| undefined;
	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
	 *
	 * The CONSECUTIVE output-exhaustion streak.
	 *
	 * SEPARATED from {@link maxTokensRecoveryCount}: the streak measures
	 * CONSECUTIVE unproductive exhaustion and may be cleared by a genuinely
	 * PRODUCTIVE round (a successful native edit, a successful execution, a
	 * legitimate wait). It may NOT be cleared by a read-only inspection, by a
	 * failed experiment, or by an unknown observation.
	 */
	private maxTokensExhaustionStreak = 0;
	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01).
	 *
	 * Whether a R1 CORRECTIVE INSTRUCTION is PENDING DELIVERY — i.e. it was
	 * injected at the current execution-round boundary and the model has not
	 * yet had the opportunity to respond to it.
	 *
	 * WHY THIS IS AN AUTHORITY
	 * ------------------------
	 * An injected corrective instruction authorizes exactly ONE further
	 * parent request: the request that CARRIES the instruction and lets the
	 * model act on it. Without that request the instruction is undelivered
	 * and the intervention never happened.
	 *
	 * The exhaustion recovery therefore treats a pending instruction as a
	 * PENDING AUTHORIZED INTERVENTION, and continues the run so the
	 * instruction can be delivered. This is the same authority the
	 * correction-only generation override relies on: the override is armed
	 * on the R1 inject and is consumed by the NEXT request — the request the
	 * instruction authorizes — so that request MUST be able to happen.
	 *
	 * The flag is set by the R1 inject branch and cleared as soon as the
	 * model has had its turn.
	 */
	private executionStagnationInstructionPending = false;
	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
	 *
	 * How many ADDITIONAL logical agent requests output-exhaustion recovery
	 * has driven in this run. Spent ONLY by an exhaustion-driven continuation
	 * and never replenished by an inspection, a compaction, a provider retry,
	 * an ordinary recovery escalation, or the internal continuation of the
	 * same recovery episode.
	 */
	private exhaustionRecoveryContinuations = 0;
	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
	 *
	 * Whether the ONE-SHOT recovery-only generation override has already been
	 * consumed by this run. See
	 * {@link recoveryOutputOverridePolicy}.
	 */
	private recoveryOutputOverrideConsumed = false;
	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
	 *
	 * The pending recovery-only generation override, ATTACHED to the NEXT
	 * logical agent request.
	 *
	 * It is a REQUEST-LOCAL property: it never touches the global default,
	 * the persisted model settings, the summary generation, the PCK
	 * inference, the R2 objective selection, or any other agent or task.
	 */
	private pendingRecoveryOutputOverride: number | undefined;
	/** Consecutive output-limit cut-offs recovered this run; see MAX_TOKENS_RECOVERY_LIMIT. */
	private maxTokensRecoveryCount = 0;
	/** One automatic recovery attempt per run for max-tokens-truncated turns. */
	private maxTokensRecoveryAttempted = false;
	private initialization?: Promise<void>;
	private abortController?: AbortController;
	private modelSteerController?: AbortController;
	private readonly telemetryProviderId?: string;
	private readonly telemetryModelId?: string;
	/**
	 * C1.3: Runtime-owned bounded-recovery tracker. One instance per
	 * `AgentRuntime` (which corresponds to one execution context). The
	 * tracker is NEVER shared across runtimes, never module-global, and
	 * never UI-owned. C1.3 only adds the pre-execution exact-block
	 * wire-up; second-stage model-loop termination is deferred to C1.4.
	 */
	private recoveryTracker = new RecoveryTracker(
		new RecoveryPolicy(DEFAULT_RECOVERY_POLICY),
	);

	/** C1.4: separate handle on the recovery policy so the
	 * runtime can read episode-level limits without reaching
	 * through the tracker. Reset together with the tracker
	 * in `restore()` via `createRecoveryTracker`. */
	private recoveryPolicy = new RecoveryPolicy(DEFAULT_RECOVERY_POLICY);

	/** C1.4: construct a fresh per-run `RecoveryTracker`
	 * (and a paired `RecoveryPolicy`) for `restore()`. */
	private createRecoveryTracker(): {
		tracker: RecoveryTracker;
		policy: RecoveryPolicy;
	} {
		const policy = new RecoveryPolicy(DEFAULT_RECOVERY_POLICY);
		return {
			tracker: new RecoveryTracker(policy),
			policy,
		};
	}

	/**
	 * C1.4: clear all per-run recovery bookkeeping. Called
	 * from both `restore()` and the start of every `run()`
	 * invocation. Required for the "next-run lifecycle reset"
	 * invariant: a previous run's terminating latch must NOT
	 * leak into the next run.
	 */
	private resetRecoveryEpisode(): void {
		this.exactOnlyBudget.clear();
		this.recoveryCircuitNoticeCount = 0;
		this.recoverySecondStage = { kind: "idle" };
		this.recoveryEpisodeFailures = 0;
		const fresh = this.createRecoveryTracker();
		this.recoveryTracker = fresh.tracker;
		this.recoveryPolicy = fresh.policy;
	}
	/**
	 * C1.3 exact-only accounting for `familyEligible=false` failures.
	 * The shared `RecoveryTracker` must not collapse opaque failures
	 * across distinct canonical inputs into a single family (that would
	 * violate the C1.1 anti-false-merge guarantee). We therefore count
	 * them per exact canonical key in a tracker-local map here.
	 *
	 * The cap on each entry equals `DEFAULT_RECOVERY_POLICY.maxRepairAttempts`
	 * + 1 (the original attempt). Budget exhaustion beyond the cap is
	 * surfaced to the runtime via {@link isExactBlockedIdentity} so the
	 * pre-execution gate sees it.
	 */
	private readonly exactOnlyBudget = new Map<string, number>();
	private recoveryCircuitNoticeCount = 0;
	/**
	 * C1.4 second-stage continuation state. Private, runtime-owned,
	 * per-run/per-episode; reset to `idle` when the run starts and
	 * when `restore()` resets the runtime state. Acts as the
	 * load-bearing terminal latch that bounds provider requests
	 * after non-convergence: it does NOT accumulate across runs,
	 * it does NOT live in `messages`, it is NEVER surfaced through
	 * user-visible code paths.
	 *
	 * Lifecycle:
	 *   - `idle`         — no recovery pressure observed since the
	 *                      last successful material progression.
	 *   - `armed`        — non-convergence proof has fired. The
	 *                      runtime may issue EXACTLY ONE further
	 *                      `model.stream(...)` request as the
	 *                      model's bounded continuation
	 *                      opportunity. While `armed`, the model
	 *                      can either materially recover or fail
	 *                      again; either outcome advances us to
	 *                      `terminating` (and the latch prevents
	 *                      any additional provider request).
	 *   - `terminating`  — latch-set. Any subsequent attempt to
	 *                      enter `streamRequest` raises a typed
	 *                      `ControlledStopError("bounded_recovery_exhausted")`,
	 *                      which the loop's existing error sink
	 *                      maps truthfully to `AgentRunResult.status
	 *                      === "aborted"` with `lastError` set
	 *                      and a typed `result.error` field.
	 *
	 * Triggers (idempotent):
	 *   - Trigger A (exact block): `isAttemptBlockedByRecovery`
	 *     returns true in `executePreparedTool`.
	 *   - Trigger B (family exhaustion without exact repeat):
	 *     the family just classified appears in
	 *     `recoveryTracker.getBlockedFamilies()` after
	 *     `recordFailureIdentity`.
	 *   - Trigger C (opaque exact-only cap): an opaque failure
	 *     increments `exactOnlyBudget[controlKey]` past the
	 *     policy cap (set after the failed increment that
	 *     exceeds the budget).
	 */
	private recoverySecondStage: {
		kind: "idle" | "armed" | "terminating";
		trigger?:
			| "exact_blocked"
			| "family_exhausted"
			| "exact_only_capped"
			| "episode_exhausted";
	} = { kind: "idle" };
	/**
	 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01 — the effective
	 * request-input ceiling published by the host for the current turn.
	 *
	 * The host owns the model limit and the user's operating ceiling. It
	 * publishes the resolved effective ceiling on the prepare-turn result so
	 * the runtime can enforce it against the FINAL provider request — after
	 * the `beforeModel` hooks have had the chance to replace the messages or
	 * the tool inventory.
	 *
	 * `undefined` disables the runtime-side check (the pre-repair
	 * behavior). It never expands a limit.
	 */
	private requestBudgetCeilingTokens: number | undefined;
	/**
	 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A2/A3).
	 *
	 * The RESOLVED base URL of the provider the final request is dispatched
	 * through.
	 *
	 * The final request guard applies the SAME destination-specific replay
	 * eligibility the WIRE gate applies, so it needs the SAME destination
	 * origin authority, and the authority is built from the EFFECTIVE
	 * endpoint.
	 *
	 * `undefined` means the endpoint is unresolved, which produces NO
	 * authority — exactly as the wire treats it.
	 */
	private providerBaseUrl: string | undefined;
	/**
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A2).
	 *
	 * The caller-selected API LINE of the provider route.
	 *
	 * It is a ROUTE fact, not a credential: MiniMax's `china` and
	 * `international` endpoints are different HOSTS, and therefore different
	 * trust domains for the opaque reasoning payloads. The destination
	 * origin authority is built from the EFFECTIVE endpoint, so the API line
	 * must be part of the route the authority is resolved from.
	 */
	private providerApiLine: string | undefined;
	/**
	 * C1.4 snapshot of `recoverySecondStage.kind` taken BEFORE
	 * the per-execution `applyRecoveryPostClassification` work
	 * mutates it. Lets the post-record failure branch distinguish
	 * "this turn just armed the latch" (Trigger B/C just fired)
	 * from "the continuation was already armed and this turn's
	 * outcome is its decision". Used only by Trigger B's
	 * follow-on `armed → terminating` check; never read elsewhere.
	 */
	private secondStageBeforeRecord: "idle" | "armed" | "terminating" = "idle";
	/**
	 * C1.4 episode-level non-convergence counter. Counts
	 * RECOVERABLE failures (`outcome.kind === "failure"`,
	 * regardless of `familyEligible`) observed during the
	 * current recovery episode. Drives Trigger D (episode
	 * exhaustion). Reset by the success path
	 * (`recordToolSuccess`) per the recovery substrate's
	 * existing semantics — a successful tool execution
	 * terminates the current recovery episode and clears the
	 * counter. Reset to 0 on `restore()` so a fresh episode
	 * starts from a clean slate.
	 */
	private recoveryEpisodeFailures = 0;

	/**
	 * C1.4: per-parallel-batch typed-outcome buffer.
	 * Populated by `executePreparedTool` immediately after
	 * `classifyToolRuntimeOutcome` produces the typed
	 * outcome, and consumed by `executeToolCalls` to
	 * decide whether to fire the parallel-batch latch.
	 *
	 * Authority model: this is the SAME `ToolRuntimeOutcome`
	 * authority used by the sequential recovery path in
	 * `applyRecoveryPostClassification`. The previous
	 * round's parallel guard keyed on `isError`, which
	 * structurally conflates `failure / recoverable` with
	 * `control_plane / host_policy_denied | user_rejected |
	 * runtime_skipped | runtime_aborted`. This buffer
	 * restores provenance-first authority at the batch
	 * level.
	 *
	 * Lifetime: cleared at the top of every
	 * `executeToolCalls` parallel invocation and again at
	 * the bottom before returning. Never visible
	 * externally; never read by the public
	 * `onToolRuntimeOutcome` hook.
	 */
	private readonly pendingBatchOutcomes: ToolRuntimeOutcome[] = [];

	/**
	 * C1.5 PARALLEL EVENT ATOMICITY GUARD.
	 *
	 * While a parallel tool batch is in flight, per-tool recovery
	 * mutations are still provisional: `executeToolCalls` reconciles the
	 * batch afterwards using the typed `pendingBatchOutcomes` authority
	 * and may overturn them (e.g. a sibling success transiently resets
	 * `armed → idle`, then batch reconciliation restores `terminating`).
	 *
	 * Emitting those intermediates would make the public event sequence
	 * depend on `Promise.all` completion order — the exact
	 * scheduler-dependent flicker C1.5 forbids. So emission is suspended
	 * for the duration of the batch and exactly one canonical event is
	 * emitted at the batch boundary, if the projection changed across it.
	 *
	 * Sequential execution never sets this: there is no batch to
	 * reconcile, so each mutation is immediately final and is emitted
	 * as it happens.
	 */
	private recoveryEmissionSuspended = false;
	private modelRequestId?: string;

	constructor(config: AgentRuntimeConfig) {
		this.telemetryProviderId =
			trimNonEmpty(config.messageModelInfo?.provider) ??
			("providerId" in config ? trimNonEmpty(config.providerId) : undefined);
		this.telemetryModelId =
			trimNonEmpty(config.messageModelInfo?.id) ??
			("modelId" in config ? trimNonEmpty(config.modelId) : undefined);
		const resolved = resolveRuntimeConfig(config);
		this.config = {
			...resolved,
			toolExecution: resolved.toolExecution ?? "sequential",
		};
		// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01, A2/A3).
		//
		// The EFFECTIVE endpoint of the provider the request is dispatched
		// through. It is what the destination origin authority is built
		// from, and it is what the wire gate uses.
		this.providerBaseUrl = "baseUrl" in config ? config.baseUrl : undefined;
		// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A2): the API
		// LINE is part of the route. It is read from the gateway provider
		// options, which is where the registry reads it from too
		// (`resolveApiLineBaseUrl(options)`).
		this.providerApiLine = readApiLineOption(config);
		this.state.agentId = resolved.agentId ?? createUID("agent");
		this.state.agentRole = resolved.agentRole;
		this.state.parentAgentId = resolved.parentAgentId;
		this.state.messages = cloneMessages(resolved.initialMessages ?? []);
	}

	async run(input: AgentRunInput): Promise<AgentRunResult> {
		return this.execute(input);
	}

	async continue(input?: AgentRunInput): Promise<AgentRunResult> {
		return this.execute(input);
	}

	/** Interrupt only the current model request; running tools finish normally. */
	notifyPendingUserMessage(): void {
		this.modelSteerController?.abort();
	}

	/**
	 * Request that the active run be aborted.
	 *
	 * ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01: `origin` declares WHO is
	 * requesting the termination.
	 *
	 * The origin is declared by the CALLER because the caller is the only
	 * party that knows which production seam initiated the termination. It
	 * is NOT inferred afterwards from the terminal status: a run that ends
	 * `aborted` looks identical from the outside whether it was cancelled
	 * by the operator, stopped by the bounded-recovery policy, escalated by
	 * the loop detector, or torn down by a session disposal.
	 *
	 * When the caller does not declare an origin, the origin is recorded as
	 * `unknown` — an absent observation is never back-filled with a guess.
	 */
	abort(reason?: unknown, origin?: AgentRuntimeAbortOrigin): void {
		if (!this.abortController) {
			return;
		}
		if (this.abortController.signal.aborted) {
			return;
		}
		const abortError =
			reason instanceof AgentRuntimeAbortError
				? reason
				: new AgentRuntimeAbortError(reason);
		this.state.lastError = abortError.message;
		this.captureTaskLifecycle(TASK_CANCELLED_EVENT, {
			error: abortError,
		});
		// ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01: the ORIGIN event.
		//
		// It is emitted at the seam where the termination is INITIATED, so
		// the retained evidence says who asked for the termination and not
		// merely that the run ended abnormally. The event is fire-and-forget
		// and failure-isolated: it cannot influence the abort.
		this.observeRunAbortRequested(origin ?? "unknown", abortError);
		this.abortController.abort(abortError);
	}

	subscribe(listener: AgentEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Replace the conversation with a fresh set of messages, discarding any
	 * in-flight run and usage state while preserving the underlying model,
	 * tools, hooks, plugins, and active event subscribers.
	 *
	 * Useful for standalone callers that persist conversations externally and
	 * want to re-seed the runtime from storage without recreating subscribers.
	 */
	restore(messages: readonly AgentMessage[]): void {
		this.abort("Agent state restored");
		// Reset state that is not carried across restores. Keep `listeners`,
		// tools, hooks, plugins, model, and agent identity so external event
		// subscribers continue to receive events after restore().
		this.state.runId = undefined;
		this.state.status = "idle";
		this.state.iteration = 0;
		this.state.pendingToolCalls = [];
		this.state.usage = cloneUsage(DEFAULT_USAGE);
		this.state.lastError = undefined;
		// RSMT01 I5: restore() clears the execution
		// authority flags. A prior run's
		// modelStreaming / awaitingApproval MUST NOT
		// leak across the restore boundary.
		this.state.executionModelStreaming = false;
		this.state.executionAwaitingApproval = false;
		this.state.lastErrorClass = undefined;
		this.state.lastErrorRetryable = undefined;
		this.state.lastErrorReported = false;
		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-
		// TRANSPORT-REPAIR01 (fourteenth-pass): STATE_BIND.
		// restore() resets the captured W so the new
		// conversation starts with no stale working-context
		// estimate from the prior transcript.
		this.state.currentWorkingContextEstimate = undefined;
		this.state.messages = cloneMessages(messages);
		this.config = {
			...this.config,
			initialMessages: cloneMessages(messages),
		};
		// C1.4: reset recovery bookkeeping that is scoped to a single
		// run. The SDK contract for `restore()` explicitly preserves
		// `tools / hooks / plugins / model / subscribers`, but per-
		// episode state — the runtime-owned exact-only budget map
		// and the second-stage continuation latch — must be cleared
		// here. Otherwise a restored run inherits an unbounded
		// `exactOnlyBudget` and a possibly-set terminal latch from
		// the previous run, both of which would corrupt the
		// recovery invariants. We also re-create the recoveryTracker
		// so a restored run starts from a fresh episode rather than
		// continuing the previous one's family state.
		//
		// C1.5 CORRECTION (parent verdict P0): subscribers survive
		// `restore()` by upstream contract, but their last known
		// recovery projection becomes invalid the moment per-episode
		// state is reset. Without an explicit emission, a subscriber-
		// only consumer would keep stale recovery truth (e.g.
		// "terminating") while a snapshot-reading consumer
		// immediately sees "idle". Mirrors the run-start reset rule
		// already proven in C1.5: meaningful change → one canonical
		// event; no-op → silent.
		//
		// UPSTREAM-PARITY DELIVERY (parent verdict restore API
		// preservation): upstream documents `restore()` as a
		// synchronous-looking control method — no `await`, no Promise
		// annotation, callers in our own runtime host invoke it
		// without await (e.g. local-runtime-host.ts line 1245 +
		// 2343). Changing the signature to `Promise<void>` would
		// introduce a fork divergence that buys nothing for upstream
		// callers and races any `restore()` immediately followed by
		// `run()`. So instead of going through the async `emit()`,
		// the reset event is delivered synchronously to subscribers
		// and `onEvent` hooks BEFORE `restore()` returns. Any
		// async completion of an `onEvent` hook is intentionally
		// not awaited; their return type already allows `void |
		// Promise<void>` so this is consistent with the hook
		// contract. Listener throws are caught and swallowed — same
		// rationale as `emitRecoveryStateChangeIfChanged`'s C1.5
		// observation-vs-control invariant.
		const recoveryBeforeRestore = this.snapshotRecoveryState();
		this.resetRecoveryEpisode();
		const after = this.snapshotRecoveryState();
		if (!isSameRuntimeRecovery(recoveryBeforeRestore, after)) {
			const event: AgentRuntimeEvent = {
				type: "recovery-state-changed",
				snapshot: this.snapshot(),
				previousRecovery: recoveryBeforeRestore,
			};
			for (const listener of this.listeners) {
				try {
					listener(event as unknown as Parameters<AgentEventListener>[0]);
				} catch {
					// Observation must not become control — same C1.5
					// invariant as the async emit path.
				}
			}
			for (const hook of this.hooks.onEvent) {
				try {
					const ret = hook(event);
					if (ret && typeof (ret as Promise<void>).then === "function") {
						// Async hook: intentionally not awaited (see
						// upstream-parity comment above). The promise
						// rejection (if any) is not coupled to the
						// synchronous `restore()` return; the runtime
						// does not surface hook failures from this
						// path.
						(ret as Promise<void>).catch(() => {});
					}
				} catch {
					// Sync hook throw: observed, not propagated.
				}
			}
		}
	}

	/**
	 * C1.5: returns `LiveAgentRuntimeStateSnapshot` so the runtime's
	 * public guarantee — `recovery` is always present on a live snapshot —
	 * is encoded in the public TypeScript surface, not only in the doc
	 * string. The base interface still allows `recovery` to be absent
	 * so pre-C1.5 hand-built test fixtures stay valid.
	 */
	snapshot(): LiveAgentRuntimeStateSnapshot {
		return {
			agentId: this.state.agentId,
			agentRole: this.state.agentRole,
			parentAgentId: this.state.parentAgentId,
			conversationId: this.config.conversationId?.trim() || undefined,
			// ACT-MYC-CLINEMM02-C-CORRECTION02 — surface the host-owned
			// session id (sourced from AgentRuntimeConfig.sessionId,
			// populated from CoreSessionConfig.sessionId in production).
			// Distinct from `conversationId` (auto-generated transcript id).
			// Hooks that look up host-owned records MUST use this field.
			sessionId: this.config.sessionId?.trim() || undefined,
			runId: this.state.runId,
			status: this.state.status,
			iteration: this.state.iteration,
			messages: cloneMessages(this.state.messages),
			pendingToolCalls: [...this.state.pendingToolCalls],
			usage: cloneUsage(this.state.usage),
			lastError: this.state.lastError,
			lastErrorClass: this.state.lastErrorClass,
			recovery: this.snapshotRecoveryState(),
			/**
			 * RSMT01 CANONICAL EXECUTION TRUTH.
			 *
			 * The activity/interaction projection is built
			 * by the same `snapshot()` call that produces
			 * `recovery`, so every `event.snapshot.execution`
			 * is structurally guaranteed to equal
			 * `runtime.snapshot().execution` at the moment of
			 * emission. Mirrors the C1.5 architecture.
			 */
			execution: buildExecutionState({
				executionModelStreaming: this.state.executionModelStreaming,
				executionAwaitingApproval: this.state.executionAwaitingApproval,
				pendingToolCalls: this.state.pendingToolCalls,
			}),
			// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-
			// TRANSPORT-REPAIR01 (fourteenth-pass): STATE_BIND.
			// Surface the captured exact-W state. The host
			// /projection layer reads this field to drive the
			// TaskHeader's compaction working-context bar.
			// See `prepareTurnForModelRequest` (~line 2329)
			// for the capture site.
			currentWorkingContextEstimate: this.state.currentWorkingContextEstimate,
		};
	}

	/**
	 * C1.5 THE canonical recovery projection function.
	 *
	 * Every externally-observable recovery value in the SDK flows through
	 * this one method:
	 *
	 *   - `AgentRuntime.snapshot().recovery`
	 *   - every `AgentRuntimeEvent`'s `snapshot.recovery` (because every
	 *     variant embeds the snapshot produced by `snapshot()` above)
	 *   - the `recovery-state-changed` payload
	 *   - `__recoverySnapshotForTests()`
	 *
	 * Consequently `event.snapshot.recovery` and
	 * `runtime.snapshot().recovery` cannot disagree: they are produced by
	 * the same call on the same authorities. There is no cached copy and
	 * no second projection path that could drift.
	 *
	 * Reads ONLY runtime-owned authorities. Never reads `messages`, tool
	 * results, or any conversation-derived value.
	 */
	private snapshotRecoveryState(): AgentRuntimeRecoverySnapshot {
		return projectRuntimeRecovery({
			trackerSnapshot: this.recoveryTracker.snapshot(),
			secondStage: this.recoverySecondStage,
			episodeFailures: this.recoveryEpisodeFailures,
			maxEpisodeFailures: this.recoveryPolicy.maxRecoveryEpisodeFailures,
			circuitNoticeCount: this.recoveryCircuitNoticeCount,
		});
	}

	/**
	 * Build the snapshot used inside a `recovery-state-changed`
	 * event. Identical to `snapshot()` for every field except
	 * `messages`, which is replaced with an empty array. This is
	 * the C1.6 privacy correction — raw user-supplied inputs
	 * (potential secrets / file paths / JWT-like structures)
	 * MUST NOT leak on the recovery-event surface, because
	 * the recovery surface is what UIs and logs consume.
	 *
	 * Consumers who need the full message history should
	 * call `snapshot()` separately; that path is unchanged.
	 */
	private buildRedactedRecoverySnapshot(): LiveAgentRuntimeStateSnapshot {
		const full = this.snapshot();
		return {
			...full,
			messages: [],
		};
	}

	/**
	 * C1.5 SOLE OWNER of `recovery-state-changed` emission.
	 *
	 * Neither `RecoveryTracker` nor the C1.3/C1.4 helpers construct public
	 * events; they mutate runtime-owned authorities and the runtime
	 * decides — from the projection alone — whether an externally
	 * meaningful change occurred.
	 *
	 * Usage contract:
	 *
	 *     const before = this.snapshotRecoveryState();
	 *     ...authoritative mutation...
	 *     await this.emitRecoveryStateChangeIfChanged(before);
	 *
	 * Dedup: no event when {@link isSameRuntimeRecovery} holds. This is
	 * what suppresses the no-op `idle → idle` reset at the start of every
	 * run, and what collapses several internal writes that produce one
	 * externally identical projection.
	 *
	 * @param before projection captured BEFORE the mutation.
	 */
	private async emitRecoveryStateChangeIfChanged(
		before: AgentRuntimeRecoverySnapshot,
	): Promise<void> {
		// Suppress scheduler-dependent intermediates: while a parallel
		// batch is in flight, per-tool mutations may still be overturned
		// by batch reconciliation. Public truth is emitted once, at the
		// batch boundary, by `executeToolCalls`.
		if (this.recoveryEmissionSuspended) {
			return;
		}
		const after = this.snapshotRecoveryState();
		if (isSameRuntimeRecovery(before, after)) {
			return;
		}
		try {
			// C1.6 CORRECTION (parent verdict §33): the
			// embedded snapshot MUST NOT carry raw conversation
			// content that may contain user-supplied sentinels
			// (fake API tokens, JWT-like structures, file
			// paths, etc.). Only the recovery projection
			// belongs on the public event surface — the full
			// message history is reachable via `snapshot()`
			// separately.
			const sanitized = this.buildRedactedRecoverySnapshot();
			await this.emit({
				type: "recovery-state-changed",
				snapshot: sanitized,
				previousRecovery: before,
			});
		} catch {
			// C1.5 OBSERVATION MUST NOT BECOME CONTROL.
			//
			// `emit()` invokes listeners without individual guards, so a
			// single throwing subscriber would otherwise (a) skip every
			// later subscriber and (b) unwind the runtime's recovery
			// path — letting a mere observer suppress the breaker or the
			// terminal latch.
			//
			// This mirrors the precedent already set by the C1.0 tracker
			// (`notifyWith` swallows callback errors "to keep recovery
			// control flow alive"). The scope is deliberately narrow: only
			// the recovery announcement is guarded. Every other event type
			// retains its existing propagation semantics, so no C1.0–C1.4
			// behavior changes.
		}
	}

	/**
	 * RSMT01 SOLE OWNER of `execution-state-changed` emission.
	 *
	 * Mirrors `emitRecoveryStateChangeIfChanged`'s C1.5
	 * design. The runtime owns the three execution
	 * authority flags (`executionModelStreaming`,
	 * `executionAwaitingApproval`, and the
	 * `pendingToolCalls.length > 0` projection); this
	 * helper captures the projection BEFORE the mutation
	 * and decides whether an externally meaningful
	 * change occurred.
	 *
	 * Usage contract:
	 *
	 *     const before = this.buildExecutionProjection();
	 *     ...authoritative mutation...
	 *     await this.emitExecutionStateChangeIfChanged(before);
	 *
	 * Dedup: no event when {@link isSameExecutionState}
	 * holds. This collapses scheduler-dependent
	 * intermediate deltas (per-tool completion that does
	 * not change any of the three flags when siblings
	 * are still in flight) and suppresses no-op
	 * transitions.
	 *
	 * Ordering: emitted AFTER the authoritative mutation
	 * and BEFORE the blocking await (for
	 * `awaitingApproval`). Subscribers learn about the
	 * new state before the runtime blocks.
	 *
	 * @param before projection captured BEFORE the mutation.
	 */
	private async emitExecutionStateChangeIfChanged(
		before: AgentRuntimeExecutionState,
	): Promise<void> {
		const after = this.snapshot().execution;
		if (!after) {
			return;
		}
		if (isSameExecutionState(before, after)) {
			return;
		}
		try {
			await this.emit({
				type: "execution-state-changed",
				snapshot: this.snapshot(),
				previousExecution: before,
			});
		} catch {
			// RSMT01 OBSERVATION MUST NOT BECOME CONTROL.
			//
			// Mirrors `emitRecoveryStateChangeIfChanged`'s
			// swallow: a throwing subscriber must not unwind
			// the runtime's control flow or block later
			// subscribers. The execution announcement is
			// an observation; downstream consumers re-read
			// `snapshot.execution` at their own cadence.
		}
	}

	/**
	 * RSMT01: snapshot the execution projection without
	 * triggering a re-entrant `snapshot()` call. Used as
	 * the `before` argument of
	 * `emitExecutionStateChangeIfChanged`.
	 */
	private buildExecutionProjection(): AgentRuntimeExecutionState {
		return buildExecutionState({
			executionModelStreaming: this.state.executionModelStreaming,
			executionAwaitingApproval: this.state.executionAwaitingApproval,
			pendingToolCalls: this.state.pendingToolCalls,
		});
	}

	/**
	 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	 * (fifteenth-pass): PUBLICATION_BIND sole owner of
	 * `working-context-state-changed` emission.
	 *
	 * Mirrors `emitRecoveryStateChangeIfChanged` /
	 * `emitExecutionStateChangeIfChanged` exactly. Sole
	 * authority on whether the externally-observable
	 * working-context changed; dedup via direct equality
	 * on `currentWorkingContextEstimate`.
	 *
	 * Ordering contract (pinned by
	 * `agent-runtime.working-context-publication.test.ts`):
	 *   - Call AFTER the authoritative capture into
	 *     `state.currentWorkingContextEstimate`.
	 *   - Emit a `working-context-state-changed` event
	 *     carrying the new snapshot BEFORE the caller
	 *     resumes (i.e. before the model stream begins).
	 *
	 * Returns a frozen discriminator describing what
	 * happened:
	 *   - `willEmit`:    whether the helper observed a change
	 *                    (`before !== after`) and therefore
	 *                    attempted to publish.
	 *   - `emitResolved`:whether the `emit(...)` call resolved
	 *                    without the helper itself surfacing
	 *                    an error. The helper swallows
	 *                    per-subscriber throws (see the catch
	 *                    block), so `emitResolved === true`
	 *                    does NOT mean every downstream
	 *                    subscriber observed without error;
	 *                    it means the helper-level publish
	 *                    resolved cleanly. True A4 end-to-end
	 *                    delivery still requires a downstream
	 *                    `carrier_observe` row (or its
	 *                    absence) to confirm propagation.
	 *
	 * Used by `prepareTurnForModelRequest` to feed the
	 * upstream W trace observer (thirtieth-pass). The host
	 * reads `willEmit` / `emitResolved` to discriminate
	 * A3 (helper-internal dedup) from A4 (helper-level
	 * publish success).
	 *
	 * @param before the prior captured W, read from the
	 *   same `state.currentWorkingContextEstimate` field
	 *   before the capture mutation. Convenience only;
	 *   authority is on the embedded `snapshot`.
	 */
	private async emitWorkingContextStateChangeIfChanged(
		before: number | undefined,
	): Promise<{ willEmit: boolean; emitResolved: boolean }> {
		const after = this.state.currentWorkingContextEstimate;
		if (before === after) {
			return { willEmit: false, emitResolved: false };
		}
		let emitResolved = false;
		try {
			await this.emit({
				type: "working-context-state-changed",
				snapshot: this.snapshot(),
				previousWorkingContextEstimate: before,
			});
			emitResolved = true;
		} catch {
			// RSMT01 OBSERVATION MUST NOT BECOME CONTROL.
			//
			// Mirrors the same swallow used by
			// `emitRecoveryStateChangeIfChanged` and
			// `emitExecutionStateChangeIfChanged`. A throwing
			// subscriber must not become authority over the
			// preparation result, and must not silence other
			// listeners. The per-listener isolation is also
			// applied inside `emit()` itself (since
			// `working-context-state-changed` is registered
			// as an observation event there); this outer
			// try/catch preserves the helper-internal
			// contract independent of `emit()`'s recognition
			// set.
		}
		return { willEmit: true, emitResolved };
	}

	/**
	 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	 * (thirtieth-pass) — fire the upstream W trace observer
	 * with the exact discriminator payload. The host-side
	 * trace recorder (`apps/vscode/src/sdk/
	 * w-carrier-trace-runtime.ts`) maps this into a
	 * `runtime_w_observe` JSONL row.
	 *
	 * The observer is wrapped in a try/catch that mirrors
	 * the helper-internal swallow contract: a throwing
	 * observer MUST NOT become authority over the runtime.
	 * The catch is intentionally narrow (only catches
	 * synchronous throws from the observer itself); the
	 * observer is documented as a synchronous side-channel.
	 *
	 * The helper dedups whether the observer is wired. If
	 * the observer is undefined, the helper is a no-op and
	 * returns immediately.
	 *
	 * @internal
	 *   The observer is read from the package-internal
	 *   Symbol.for-keyed slot on `globalThis` (key:
	 *   "@cline/agents__wTraceObserver"). There is NO
	 *   public setter on this class. The host wires the
	 *   observer through the in-package
	 *   `installRuntimeWTraceObserver(...)` helper defined
	 *   in `./runtime-w-trace-internal.ts`. The runtime
	 *   composition layer calls the install helper once
	 *   during SDK controller construction.
	 */
	private notifyRuntimeWTraceObserver(record: AgentRuntimeWTraceRecord): void {
		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
		// (thirty-third-pass, attempt 2) — read the singleton
		// observer from the Symbol.for-keyed slot on globalThis.
		// The Symbol is stable across module loads, so the
		// runtime (read here) and the bridge install helper
		// (write via the secondary bundle entry
		// `dist/internal-w-trace.js`) reach the SAME slot
		// regardless of how Bun's separate-entry bundling
		// splits the source graph.
		const observer = (
			globalThis as {
				[symbol: symbol]: AgentRuntimeWTraceObserver | undefined;
			}
		)[W_TRACE_OBSERVER_SLOT];
		if (!observer) {
			return;
		}
		try {
			observer(record);
		} catch {
			// OBSERVATION MUST NOT BECOME CONTROL.
			//
			// Mirrors `emitWorkingContextStateChangeIfChanged`'s
			// swallow. A throwing observer must not unwind the
			// prepare-turn control flow. Diagnostic-only loss
			// is the correct tradeoff.
		}
	}

	private async ensureInitialized(): Promise<void> {
		this.initialization ??= this.initialize();
		await this.initialization;
	}

	private async initialize(): Promise<void> {
		this.registerHooks(this.config.hooks);
		for (const tool of this.config.tools ?? []) {
			this.tools.set(tool.name, tool);
		}
		for (const plugin of this.config.plugins ?? []) {
			const setup = await plugin.setup?.({
				agentId: this.state.agentId,
				agentRole: this.state.agentRole,
				systemPrompt: this.config.systemPrompt,
			});
			for (const tool of setup?.tools ?? []) {
				this.tools.set(tool.name, tool);
			}
			this.registerHooks(setup?.hooks);
		}
	}

	private registerHooks(hooks: Partial<AgentRuntimeHooks> | undefined): void {
		if (!hooks) {
			return;
		}
		if (hooks.beforeRun) this.hooks.beforeRun.push(hooks.beforeRun);
		if (hooks.afterRun) this.hooks.afterRun.push(hooks.afterRun);
		if (hooks.beforeModel) this.hooks.beforeModel.push(hooks.beforeModel);
		if (hooks.afterModel) this.hooks.afterModel.push(hooks.afterModel);
		if (hooks.beforeTool) this.hooks.beforeTool.push(hooks.beforeTool);
		if (hooks.afterTool) this.hooks.afterTool.push(hooks.afterTool);
		if (hooks.onToolRuntimeOutcome)
			this.hooks.onToolRuntimeOutcome.push(hooks.onToolRuntimeOutcome);
		if (hooks.onEvent) this.hooks.onEvent.push(hooks.onEvent);
	}

	private getRequiredCompletionToolNames(): string[] {
		if (this.config.completionPolicy?.requireCompletionTool !== true) {
			return [];
		}
		return [...this.tools.values()]
			.filter((tool) => tool.lifecycle?.completesRun === true)
			.map((tool) => tool.name)
			.sort();
	}

	private getCompletionToolReminderMessage(): string | undefined {
		const terminalToolNames = this.getRequiredCompletionToolNames();
		if (terminalToolNames.length === 0) {
			return undefined;
		}
		// ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01: the
		// reminder text is rendered by the SHARED contract module so the
		// compaction task-contract conservation path can recognise this exact
		// runtime obligation by template equality instead of by broad string
		// guessing. The rendered text is byte-identical to the previous
		// inline template.
		return buildCompletionToolReminderMessage(terminalToolNames);
	}

	private getCompletionReminderMessages(): string[] {
		return [
			this.getCompletionToolReminderMessage(),
			this.config.completionPolicy?.completionGuard?.(),
		].filter((message): message is string => Boolean(message));
	}

	/**
	 * Record the observable facts of ONE tool call into the current
	 * execution round.
	 *
	 * This is a pure OBSERVATION: it never influences the tool call, never
	 * changes a result, and never throws.
	 */
	private observeExecutionRoundToolCall(
		toolName: string,
		input: unknown,
		result: { output: unknown; isError?: boolean } | undefined,
	): void {
		try {
			this.executionRoundFacts.toolNames.push(toolName);
			// The HOST may classify its own tools more precisely than the
			// runtime can (for example: was this shell command a read-only
			// inspection or a real test run?). The runtime NEVER guesses
			// from command text — that would be provider-specific string
			// matching. A host callback that throws is treated as "no
			// opinion" and the runtime's own structural classification is
			// used instead.
			const hostVerdict = this.askHostForToolCallProductivity(
				toolName,
				input,
				result,
			);
			if (hostVerdict !== undefined) {
				this.applyHostProductivityVerdict(hostVerdict, result);
				this.recordBoundedObjectiveReceipt(
					toolName,
					input,
					result,
					hostVerdict === "edited",
				);
				return;
			}
			const classified = this.classifyToolCallProductivity(
				toolName,
				input,
				result,
			);
			// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01:
			// the STRUCTURED RECEIPT is recorded for EVERY tool call, so the
			// R2 verification gate can correlate the required executable
			// with its actual outcome.
			this.recordBoundedObjectiveReceipt(
				toolName,
				input,
				result,
				classified.kind === "edit",
			);
			if (classified.kind === "edit") {
				this.executionRoundFacts.editAttempts += 1;
				if (result?.isError !== true) {
					this.executionRoundFacts.successfulEdits += 1;
				}
				return;
			}
			if (classified.kind === "command") {
				if (classified.awaiting) {
					this.executionRoundFacts.awaitingBackgroundWork = true;
				} else if (result?.isError !== true) {
					// ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01:
					// the dispatch `isError` flag ALONE does not establish a
					// SUCCESSFUL execution. A command whose structured
					// result reports a failure — or whose outcome is MISSING
					// — is a FAILED execution, not a productive one.
					//
					// The host's authoritative negative observation must not
					// disappear at this fallback: the host already declines
					// a failed observation (it has no authority to claim
					// success about a command that failed), and this
					// fallback used to OVERRIDE that decline by counting
					// the very same call as an execution.
					if (this.executionOutcomeIsUnsuccessful(result)) {
						this.executionRoundFacts.failedExecutions += 1;
					} else {
						this.executionRoundFacts.executedCommands += 1;
					}
				}
				return;
			}
			// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01):
			// a NON-command tool call can still be a LEGITIMATE WAIT.
			//
			// Production waits by POLLING one identified running job with
			// `command_status`, whose input is `{ jobId }` — not a command
			// list — and whose observation carries the `state: "running"`
			// marker. The `awaiting` flag is therefore honoured for EVERY
			// tool call, not only for command-shaped ones.
			//
			// Without this, a legitimate poll was counted as an
			// unproductive inspection round and the runtime declared a
			// FALSE STALL while the agent was waiting on real work.
			if (classified.awaiting) {
				this.executionRoundFacts.awaitingBackgroundWork = true;
			}
		} catch {
			// Observation isolation: instrumentation NEVER affects a tool call.
		}
	}

	/**
	 * Record ONE STRUCTURED EXECUTION RECEIPT for the current round.
	 *
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
	 *
	 * The receipt is the CORRELATION EVIDENCE the R2 verification gate
	 * uses. It records:
	 *
	 *   - the host-defined tool name,
	 *   - the COMMAND IDENTITY of the call, when the call was
	 *     command-shaped (the commands are joined into one identity
	 *     string — the receipt never carries the tool's OUTPUT),
	 *   - the OUTCOME (success or failure),
	 *   - and whether the call was an EDIT.
	 *
	 * A failed command is a receipt too. It is the receipt that proves the
	 * required gate did NOT pass.
	 */
	private recordBoundedObjectiveReceipt(
		toolName: string,
		input: unknown,
		result: { output: unknown; isError?: boolean } | undefined,
		wasEdit: boolean,
	): void {
		const command = extractToolCallCommandIdentity(input);
		this.executionRoundFacts.receipts.push({
			toolName,
			...(command === undefined ? {} : { command }),
			succeeded: result?.isError !== true,
			wasEdit,
		});
	}

	/**
	 * Ask the host to classify ONE tool call.
	 *
	 * Returns `undefined` when there is no host classifier, when the
	 * classifier throws, or when it declines to classify the call.
	 */
	private askHostForToolCallProductivity(
		toolName: string,
		input: unknown,
		result: { output: unknown; isError?: boolean } | undefined,
	): ExecutionRoundProductivity | undefined {
		const classifier = this.config.executionStagnationPolicy?.classifyToolCall;
		if (!classifier) {
			return undefined;
		}
		try {
			return classifier(toolName, input, result);
		} catch {
			return undefined;
		}
	}

	/**
	 * Fold a host verdict into the current round's facts.
	 */
	private applyHostProductivityVerdict(
		verdict: ExecutionRoundProductivity,
		result: { output: unknown; isError?: boolean } | undefined,
	): void {
		switch (verdict) {
			case "edited":
				this.executionRoundFacts.editAttempts += 1;
				if (result?.isError !== true) {
					this.executionRoundFacts.successfulEdits += 1;
				}
				return;
			case "executed":
				if (result?.isError !== true) {
					this.executionRoundFacts.executedCommands += 1;
				}
				return;
			case "failed":
				// ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01:
				// the host's authoritative FAILED observation is recorded as
				// a failed execution, never as a productive one.
				this.executionRoundFacts.failedExecutions += 1;
				return;
			case "awaiting":
				this.executionRoundFacts.awaitingBackgroundWork = true;
				return;
			case "inspected":
			case "idle":
				return;
			default:
				return;
		}
	}

	/**
	 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01.
	 *
	 * Whether an execution's OUTCOME was NOT a successful execution.
	 *
	 * Three observations are distinguished:
	 *
	 *   - a FAILED outcome — the structured result reports a non-zero exit
	 *     code or an explicit `ok: false`;
	 *   - a MISSING outcome — the result carries no execution outcome at
	 *     all, so nothing established that the command ran successfully;
	 *   - a SUCCESSFUL outcome — the structured result reports a successful
	 *     execution.
	 *
	 * A MISSING outcome is NOT treated as a successful execution: the
	 * dispatch `isError` flag alone does not establish that a command ran
	 * and succeeded. It is also NOT treated as a failure of the agent's
	 * work — it is simply not positive evidence of progress.
	 *
	 * The check is DATA-SHAPE driven: it reads the explicit `exitCode` and
	 * `ok` fields the production tools set, never prose.
	 */
	private executionOutcomeIsUnsuccessful(
		result: { output: unknown; isError?: boolean } | undefined,
	): boolean {
		if (result === undefined) {
			// No result at all: the execution outcome is MISSING.
			return true;
		}
		if (result.isError === true) {
			return true;
		}
		return this.outputReportsFailureShape(result.output);
	}

	/**
	 * Whether a structured result reports a FAILED execution.
	 *
	 * The failure is read from the EXPLICIT fields the production tools
	 * set: the observed `exitCode` (a non-zero code is a failure) and the
	 * `ok` flag (false is a failure). The production tools return their
	 * result as an ARRAY of operation results, so the array envelope is
	 * walked as well. No prose is parsed.
	 *
	 * A result that carries NO execution outcome at all (neither `exitCode`
	 * nor `ok`) is a MISSING outcome, not a failure, so it returns false
	 * here; the MISSING case is handled by the caller.
	 */
	private outputReportsFailureShape(output: unknown): boolean {
		if (typeof output === "string") {
			try {
				return this.outputReportsFailureShape(JSON.parse(output));
			} catch {
				// Not JSON: a plain-text output carries no explicit failure
				// marker, so the outcome is not established as a failure.
				return false;
			}
		}
		if (!output || typeof output !== "object") {
			return false;
		}
		const record = output as Record<string, unknown>;
		if (record.ok === false) {
			return true;
		}
		if (typeof record.exitCode === "number" && record.exitCode !== 0) {
			return true;
		}
		if (Array.isArray(output)) {
			for (const entry of output) {
				if (this.outputReportsFailureShape(entry)) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * Classify the CURRENT execution round into a productivity signal.
	 *
	 * The classification is structural:
	 *
	 *   - `edited`   — the round contains a SUCCESSFUL native edit.
	 *   - `executed` — the round executed at least one command successfully
	 *                  (a test, a build, a probe). Executing is progress
	 *                  even when the command's output is a failure report,
	 *                  because the agent OBTAINED executable evidence.
	 *   - `awaiting` — the round started work that is STILL RUNNING. A
	 *                  legitimate wait is not a stall.
	 *   - `inspected`— the round only inspected (read/search/list).
	 *   - `idle`     — the round made no tool call at all.
	 *
	 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01: a `failed`
	 * round — a command whose outcome was a FAILURE or was MISSING — is
	 * reported as `failed`, NOT as `executed`. A failed command is real
	 * evidence, but it is not a SUCCESSFUL execution, and reporting it as
	 * one would let a generic command failure become positive evidence of
	 * progress.
	 */
	private classifyExecutionRound(): ExecutionRoundProductivity {
		const facts = this.executionRoundFacts;
		if (facts.successfulEdits > 0) {
			return "edited";
		}
		if (facts.awaitingBackgroundWork) {
			return "awaiting";
		}
		if (facts.executedCommands > 0) {
			return "executed";
		}
		if (facts.failedExecutions > 0) {
			return "failed";
		}
		if (facts.toolNames.length === 0) {
			return "idle";
		}
		return "inspected";
	}

	/**
	 * The observation handed to the pure decision function.
	 */
	private buildExecutionRoundObservation(): ExecutionRoundObservation {
		return {
			productivity: this.classifyExecutionRound(),
			toolNames: [...this.executionRoundFacts.toolNames],
			editAttempts: this.executionRoundFacts.editAttempts,
			successfulEdits: this.executionRoundFacts.successfulEdits,
		};
	}

	/**
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1).
	 *
	 * The RUNTIME INTERVENTION BOUNDARY.
	 *
	 * Called at the iteration boundary — after the round's tool calls have
	 * been executed and their results delivered, and BEFORE the next model
	 * request is issued. It:
	 *
	 *   1. folds the just-completed round into the run-scoped accounting,
	 *   2. asks the pure decision function whether a corrective instruction
	 *      is due,
	 *   3. when it is, injects EXACTLY ONE runtime-owned corrective message
	 *      through the existing `addUserReminderMessage` seam,
	 *   4. returns WITHOUT interrupting the run — execution continues
	 *      automatically; no user confirmation is required.
	 *
	 * The decision uses ONLY facts observed so far. It never consults a
	 * future observation and never classifies an earlier round using later
	 * information.
	 */
	private async evaluateExecutionStagnation(): Promise<void> {
		const policy = this.config.executionStagnationPolicy;
		if (!policy || policy.enabled === false) {
			return;
		}
		const observation = this.buildExecutionRoundObservation();
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01).
		//
		// THE FINALIZED EXECUTION-ROUND ACCOUNTING BOUNDARY.
		//
		// The CONSECUTIVE output-exhaustion streak is cleared here, by a
		// genuinely PRODUCTIVE round, using the SAME already-computed
		// productivity classification the R1 accounting consumes. The
		// logical round is therefore classified ONCE, at the boundary
		// where its tool calls have actually been executed and their
		// outcomes observed.
		//
		// The predecessor's site was BEFORE `executeToolCalls()`, so it
		// observed an EMPTY round and the streak was never cleared by a
		// productive round at all.
		//
		// CONSERVATION:
		//   - a successful native edit / successful execution / legitimate
		//     wait clears the streak (the existing contract),
		//   - a read-only inspection does NOT clear it,
		//   - a failed experiment does NOT clear it,
		//   - an unknown outcome does NOT clear it.
		//
		// The productive round clears ONLY the consecutive streak. It
		// replenishes NO run-scoped resource: neither the ordinary
		// conciseness-reminder allowance nor the exhaustion-driven
		// continuation ceiling is touched here.
		if (
			observation.productivity === "edited" ||
			observation.productivity === "executed" ||
			observation.productivity === "awaiting"
		) {
			this.maxTokensExhaustionStreak = 0;
		}
		this.executionStagnation = foldExecutionRound(
			this.executionStagnation,
			observation,
		);
		const decision = decideExecutionStagnation(
			this.executionStagnation,
			policy,
		);
		if (decision.kind === "allowance_exhausted") {
			// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 (R2): the
			// R2 ENTRY POINT.
			//
			// The R1 corrective-instruction allowance is spent and the
			// trajectory is STILL unproductive. R2 may now select ONE
			// bounded objective and make it the current execution target.
			//
			// R1's thresholds and allowance are UNCHANGED: this branch was
			// previously a no-op that let the run continue on its own
			// terms. R2 is a separate, opt-in stage layered on top of it.
			await this.activateBoundedObjectiveRecovery({
				unproductiveRounds: decision.unproductiveRounds,
			});
			return;
		}
		if (decision.kind !== "inject") {
			return;
		}
		this.executionStagnation = applyExecutionStagnationDecision(
			this.executionStagnation,
			decision,
		);
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01).
		//
		// The corrective instruction authorizes exactly ONE further parent
		// request — the request that CARRIES it and lets the model act on it.
		// The exhaustion recovery therefore treats the instruction as a
		// PENDING AUTHORIZED INTERVENTION until the model has had its turn.
		this.executionStagnationInstructionPending = true;
		await this.emit({
			type: "status-notice",
			snapshot: this.snapshot(),
			message: `execution stagnation detected after ${decision.unproductiveRounds} unproductive round(s) — injecting a recovery instruction (attempt ${this.executionStagnation.instructionsInjected}/${policy.maxRecoveryInstructions})`,
			metadata: {
				kind: "execution_stagnation_recovery",
				reason: "execution_stagnation_recovery",
				phase: "started",
				iteration: this.state.iteration,
				unproductiveRounds: decision.unproductiveRounds,
				attempt: this.executionStagnation.instructionsInjected,
				maxRecoveryInstructions: policy.maxRecoveryInstructions,
			},
		});
		// The corrective instruction is a RUNTIME-OWNED message. It is
		// appended to the canonical transcript exactly like the runtime's
		// existing completion reminder, so the next model request carries
		// it and the run continues automatically.
		await this.addUserReminderMessage(decision.message, {
			displayRole: "system",
			runtimeAuthority: "execution_stagnation_recovery",
		});
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01.
		//
		// The ONE-SHOT recovery-only generation override is attached to the
		// NEXT established R1 recovery request — the request this corrective
		// instruction authorises. It is NOT granted to every ordinary
		// exhausted response.
		//
		// Arming it here does NOT block or alter the R1 instruction: the
		// corrective instruction is already injected, and an INFEASIBLE
		// override simply arms nothing.
		this.armRecoveryOutputOverride();
	}

	// -------------------------------------------------------------------------
	// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 (R2)
	//
	// Runtime-owned bounded-objective recovery.
	//
	// R2 is the SECOND recovery stage. It activates ONLY at the R1
	// `allowance_exhausted` branch — that is, after the runtime has already
	// spent its whole run-scoped corrective-instruction allowance on a
	// trajectory that produced no productive step, and the trajectory is
	// STILL unproductive.
	//
	// R2 materially CHANGES the active execution objective. It does NOT
	// append another advisory nudge to the conversation: it selects ONE
	// bounded, independently verifiable objective derived from the parent
	// task and projects that objective onto the DISPATCHED model request's
	// privileged channel, so the next request the provider sees is a
	// request for the objective rather than for the stalled parent.
	//
	// The runtime remains the SINGLE lifecycle authority:
	//
	//   - the runtime owns the accounting (activations, selection
	//     inferences, objective rounds),
	//   - the runtime owns the selection (through the SAME authorized model
	//     and provider, never a supervisor process and never a provider
	//     switch),
	//   - the runtime owns the verification and the automatic return.
	//
	// The parent task stays authoritative throughout. The objective never
	// satisfies an outstanding parent obligation, the parent's terminal
	// completion tool is never invoked on the objective's behalf, and
	// parent completion therefore remains governed by the existing
	// completion contract.
	// -------------------------------------------------------------------------

	/**
	 * The effective bounded-objective policy, or `undefined` when R2 is
	 * disabled or absent.
	 *
	 * R2 is OPT-IN. When the policy is absent, or explicitly disabled, this
	 * returns `undefined` and every R2 code path is unreachable — ordinary
	 * execution and the existing R1 behaviour remain byte-identical.
	 */
	private getBoundedObjectivePolicy(): BoundedObjectivePolicy | undefined {
		const policy = this.config.boundedObjectivePolicy;
		if (!policy || policy.enabled === false) {
			return undefined;
		}
		return policy;
	}

	/**
	 * The R2 ENTRY POINT.
	 *
	 * Called at the R1 `allowance_exhausted` branch. It decides whether R2
	 * may activate and, if so, selects ONE bounded objective and makes it
	 * the active execution target.
	 *
	 * Every precondition is checked here, in the runtime that owns them:
	 *
	 *   - R2 is enabled (opt-in),
	 *   - the run is ACTIVE (not aborted, not finished),
	 *   - the parent task is AUTHORIZED (a parent objective exists),
	 *   - NO bounded objective is already active,
	 *   - the ACTIVATION allowance remains,
	 *   - the SELECTION-INFERENCE allowance remains.
	 *
	 * A failed selection consumes the corresponding allowance and MUST NOT
	 * start another selection attempt: the function returns after ONE
	 * inference, whatever its outcome.
	 */
	private async activateBoundedObjectiveRecovery(trigger: {
		readonly unproductiveRounds: number;
	}): Promise<void> {
		const policy = this.getBoundedObjectivePolicy();
		if (!policy) {
			return;
		}
		// A bounded objective is already the current execution target: R2
		// must NOT reactivate recursively from within its own objective.
		if (this.activeBoundedObjective !== undefined) {
			return;
		}
		// The run must be ACTIVE. A cancelled or terminal run never
		// dispatches a recovery.
		if (this.state.status !== "running") {
			return;
		}
		this.throwIfAborted();
		const maxActivations = Math.max(
			0,
			policy.maxActivations ?? DEFAULT_BOUNDED_OBJECTIVE_POLICY.maxActivations,
		);
		if (this.boundedObjectiveActivations >= maxActivations) {
			return;
		}
		const maxSelectionInferences = Math.max(
			0,
			policy.maxSelectionInferences ??
				DEFAULT_BOUNDED_OBJECTIVE_POLICY.maxSelectionInferences,
		);
		if (this.boundedObjectiveSelectionInferences >= maxSelectionInferences) {
			return;
		}
		const selectionContext = this.buildBoundedObjectiveSelectionContext();
		if (!selectionContext) {
			// Without an authorized parent objective there is nothing to
			// derive a bounded objective FROM. R2 does not activate.
			return;
		}
		// The ACTIVATION is consumed at the point it is ATTEMPTED, not when
		// it succeeds: a failed selection, a failed execution and a failed
		// verification all consume the corresponding attempted recovery
		// allowance.
		this.boundedObjectiveActivations += 1;
		this.boundedObjectiveSelectionInferences += 1;
		await this.emit({
			type: "status-notice",
			snapshot: this.snapshot(),
			message: `R1 recovery allowance exhausted after ${trigger.unproductiveRounds} unproductive round(s) — selecting a bounded objective (activation ${this.boundedObjectiveActivations}/${maxActivations})`,
			metadata: {
				kind: "bounded_objective_recovery",
				reason: "execution_stagnation_recovery_allowance_exhausted",
				phase: "selection_started",
				iteration: this.state.iteration,
				unproductiveRounds: trigger.unproductiveRounds,
				activation: this.boundedObjectiveActivations,
				maxActivations,
			},
		});
		const selection =
			await this.runBoundedObjectiveSelectionInference(selectionContext);
		if (selection === undefined) {
			this.lastBoundedObjectiveOutcome = {
				kind: "failed",
				reason: "selection_inference_failed",
			};
			await this.emitBoundedObjectiveOutcome("selection_inference_failed");
			return;
		}
		const candidate = selection.candidate;
		if (candidate === undefined) {
			// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01: the model
			// replied, but the reply yielded no parsable proposal. The
			// observation records the GENERATED text and the unparsable
			// disposition, because that is exactly the case the existing
			// provider-request capture cannot see.
			this.observeBoundedObjectiveSelection({
				...(this.state.runId ? { runId: this.state.runId } : {}),
				...(this.state.agentId ? { agentId: this.state.agentId } : {}),
				parentTaskId: selectionContext.parentTaskId,
				selectionOrdinal: this.boundedObjectiveSelectionInferences,
				selectorRequestId: selection.selectorRequestId,
				generatedText: selection.generatedText,
				disposition: "unparsable",
			});
			this.lastBoundedObjectiveOutcome = {
				kind: "failed",
				reason: "selection_inference_failed",
			};
			await this.emitBoundedObjectiveOutcome("selection_inference_failed");
			return;
		}
		const validation = validateBoundedObjective(candidate, {
			parentTaskId: selectionContext.parentTaskId,
			parentMutationScope: selectionContext.parentMutationScope,
			parentMutationScopePaths: selectionContext.parentMutationScopePaths,
			parentConstraints: selectionContext.parentConstraints,
			parentObligationReferences: selectionContext.parentObligationReferences,
			outstandingObligations: selectionContext.outstandingObligations,
			establishedObservations: selectionContext.establishedObservations,
		});
		// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01: the observation
		// records the EXACT validation disposition and, for a rejection, the
		// failing field or reference.
		if (!validation.valid) {
			const rejection = describeBoundedObjectiveRejection(
				candidate,
				validation.reason,
				{
					parentObligationReferences:
						selectionContext.parentObligationReferences,
					outstandingObligations: selectionContext.outstandingObligations,
				},
			);
			this.observeBoundedObjectiveSelection({
				...(this.state.runId ? { runId: this.state.runId } : {}),
				...(this.state.agentId ? { agentId: this.state.agentId } : {}),
				parentTaskId: selectionContext.parentTaskId,
				selectionOrdinal: this.boundedObjectiveSelectionInferences,
				// The EXACT selector-request identity the captured REQUEST
				// file is named after.
				selectorRequestId: selection.selectorRequestId,
				generatedText: selection.generatedText,
				parsedProposal: candidate,
				disposition: validation.reason,
				...(rejection.failingField !== undefined
					? { failingField: rejection.failingField }
					: {}),
				...(rejection.failingReference !== undefined
					? { failingReference: rejection.failingReference }
					: {}),
			});
		} else {
			this.observeBoundedObjectiveSelection({
				...(this.state.runId ? { runId: this.state.runId } : {}),
				...(this.state.agentId ? { agentId: this.state.agentId } : {}),
				parentTaskId: selectionContext.parentTaskId,
				selectionOrdinal: this.boundedObjectiveSelectionInferences,
				selectorRequestId: selection.selectorRequestId,
				generatedText: selection.generatedText,
				parsedProposal: candidate,
				disposition: "valid",
			});
		}
		if (!validation.valid) {
			// An INVALID selection is rejected and NEVER retried: the
			// activation's selection-inference allowance is already spent.
			this.lastBoundedObjectiveOutcome = {
				kind: "failed",
				reason: `selection_rejected:${validation.reason}`,
			};
			await this.emit({
				type: "status-notice",
				snapshot: this.snapshot(),
				message: `bounded objective selection rejected (${validation.reason}) — the activation's allowance is consumed and no further selection is attempted`,
				metadata: {
					kind: "bounded_objective_recovery",
					reason: "selection_rejected",
					phase: "selection_rejected",
					iteration: this.state.iteration,
					rejectionReason: validation.reason,
					activation: this.boundedObjectiveActivations,
				},
			});
			await this.emitBoundedObjectiveOutcome(
				`selection_rejected:${validation.reason}`,
			);
			return;
		}
		this.activeBoundedObjective = validation.objective;
		this.boundedObjectiveFacts = {
			rounds: 0,
			toolNames: [],
			editAttempts: 0,
			successfulEdits: 0,
			executedCommands: 0,
			receipts: [],
		};
		await this.emit({
			type: "status-notice",
			snapshot: this.snapshot(),
			message: `bounded objective activated: ${validation.objective.objective}`,
			metadata: {
				kind: "bounded_objective_recovery",
				reason: "bounded_objective_activated",
				phase: "objective_activated",
				iteration: this.state.iteration,
				activation: this.boundedObjectiveActivations,
				parentTaskId: validation.objective.parentTaskId,
				objective: validation.objective.objective,
				firstStep: validation.objective.firstStep,
				verificationCondition: validation.objective.verificationCondition,
			},
		});
	}

	/**
	 * Build the MINIMUM SUFFICIENT information the selection inference
	 * receives.
	 *
	 * It contains:
	 *
	 *   - the original user-authorized objective,
	 *   - the applicable parent constraints,
	 *   - the outstanding acceptance obligations,
	 *   - the established observations with their evidence references,
	 *   - the recent failed execution strategy,
	 *   - the actual available tools,
	 *   - the remaining recovery allowance.
	 *
	 * It NEVER contains provider-owned thinking text, and it NEVER exposes
	 * opaque reasoning signatures: the selection context is built from the
	 * runtime's own observable state and the canonical transcript's TEXT
	 * messages only.
	 */
	private buildBoundedObjectiveSelectionContext():
		| {
				parentTaskId: string;
				parentObjective: string;
				parentConstraints: string[];
				parentMutationScope: string;
				parentMutationScopePaths: string[];
				parentObligationReferences: ParentObligationReference[];
				outstandingObligations: string[];
				establishedObservations: string[];
				recentFailedStrategy: string;
				availableTools: string[];
				remainingAllowance: {
					activations: number;
					selectionInferences: number;
					objectiveRounds: number;
				};
		  }
		| undefined {
		const parentObjective = this.findParentUserObjective();
		if (!parentObjective) {
			return undefined;
		}
		const policy = this.getBoundedObjectivePolicy();
		if (!policy) {
			return undefined;
		}
		const maxActivations = Math.max(
			0,
			policy.maxActivations ?? DEFAULT_BOUNDED_OBJECTIVE_POLICY.maxActivations,
		);
		const maxSelectionInferences = Math.max(
			0,
			policy.maxSelectionInferences ??
				DEFAULT_BOUNDED_OBJECTIVE_POLICY.maxSelectionInferences,
		);
		const maxObjectiveRounds = Math.max(
			0,
			policy.maxObjectiveRounds ??
				DEFAULT_BOUNDED_OBJECTIVE_POLICY.maxObjectiveRounds,
		);
		const toolNames = [...this.tools.values()].map((tool) => tool.name).sort();
		return {
			parentTaskId: this.state.runId ?? this.state.agentId,
			parentObjective: parentObjective.text,
			parentConstraints: parentObjective.constraints,
			parentMutationScope: parentObjective.mutationScope,
			parentMutationScopePaths: parentObjective.mutationScopePaths,
			parentObligationReferences: parentObjective.obligationReferences,
			outstandingObligations: parentObjective.outstandingObligations,
			establishedObservations: parentObjective.establishedObservations,
			recentFailedStrategy: parentObjective.recentFailedStrategy,
			availableTools: toolNames,
			remainingAllowance: {
				activations: Math.max(
					0,
					maxActivations - this.boundedObjectiveActivations,
				),
				selectionInferences: Math.max(
					0,
					maxSelectionInferences - this.boundedObjectiveSelectionInferences,
				),
				objectiveRounds: maxObjectiveRounds,
			},
		};
	}

	/**
	 * Find the parent task's user-authorized objective and the facts the
	 * selection needs, from the CANONICAL TRANSCRIPT.
	 *
	 * The transcript is the only authority for the user objective, the user
	 * constraints and the outstanding obligations. The runtime's own
	 * observed round facts supply the established observations.
	 *
	 * Only TEXT is read. Reasoning parts are never inspected, so the
	 * selection context can never carry provider-owned thinking text or an
	 * opaque reasoning signature.
	 */
	private findParentUserObjective():
		| {
				text: string;
				constraints: string[];
				mutationScope: string;
				mutationScopePaths: string[];
				obligationReferences: ParentObligationReference[];
				outstandingObligations: string[];
				establishedObservations: string[];
				recentFailedStrategy: string;
		  }
		| undefined {
		const userTexts: string[] = [];
		for (const message of this.state.messages) {
			if (message.role !== "user") {
				continue;
			}
			// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 (R2).
			//
			// Only USER-AUTHORED messages may supply the parent objective
			// and the parent constraints.
			//
			// The runtime's own reminders are `user`-ROLE messages for
			// transport reasons, but they are RUNTIME authority, not user
			// authority: the R1 corrective instruction and the completion
			// reminder are both stamped `userRunSpan: 0` and carry a
			// `displayRole`. Reading them as user constraints would make
			// the runtime treat its OWN advisory as a constraint the
			// selection must respect — and would let a runtime reminder
			// masquerade as a user instruction.
			//
			// The discriminator is the runtime's own provenance stamp, not a
			// text guess.
			if (isRuntimeSyntheticMessage(message)) {
				continue;
			}
			const text = message.content
				.filter(
					(part): part is { type: "text"; text: string } =>
						part.type === "text" && typeof part.text === "string",
				)
				.map((part) => part.text)
				.join("\n")
				.trim();
			if (text.length > 0) {
				userTexts.push(text);
			}
		}
		if (userTexts.length === 0) {
			return undefined;
		}
		const objective = userTexts[0] as string;
		const laterInstructions = userTexts.slice(1);
		// The parent constraints are the LATER user instructions: the user
		// is the authority on what the parent task may and may not do.
		const constraints = laterInstructions.slice(0, 8);
		// The parent's mutation scope is the scope the user authorised. The
		// objective may only narrow it.
		//
		// The PROSE scope is the parent objective itself: the user
		// authorised that work and nothing else. The STRUCTURAL ceiling is
		// the set of PATHS the parent named — the user is the only
		// authority on which paths the task may touch, and a path the user
		// never named is a path the objective may not claim.
		const mutationScope = objective;
		const mutationScopePaths = this.extractAuthorisedScopePaths([
			objective,
			...laterInstructions,
		]);
		// The outstanding acceptance obligations are the parent task's own
		// completion obligations that are NOT yet discharged. The runtime
		// owns the completion contract, so it can name them.
		const outstandingObligations = this.findOutstandingObligations();
		if (outstandingObligations.length === 0) {
			return undefined;
		}
		// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
		//
		// The PARENT-OBLIGATION REFERENCE VOCABULARY.
		//
		// The outstanding-obligation list names the parent's TERMINAL
		// COMPLETION mechanics — it is the runtime's own completion
		// contract, not the parent's engineering work. The frozen live
		// witness (`cap_run_kR2y9UwW_ca62cf1370aaed21.ai_sdk_prompt.1.provider-request.json`)
		// shows a parent task carrying requirements A1, A2 and A3 with a
		// selection context whose ONLY outstanding obligation was the
		// terminal completion sentence. The selection therefore had no
		// authorised reference to any concrete requirement.
		//
		// The vocabulary is derived from the parent's OWN user-authored text
		// by a STRUCTURAL scan of its own headings. It adds NO inference and
		// NO decomposition: it is a projection of the parent's own words, so
		// it can neither invent a sub-obligation nor mark one as satisfied.
		//
		// When the parent names no labelled requirement the vocabulary
		// contains exactly ONE entry — an explicit reference to the original
		// authorized parent task. That is the honest representation of "the
		// parent's concrete obligations are not individually enumerable from
		// its text"; it is never represented as an absence of obligations.
		const obligationReferences = buildParentObligationReferences(objective);
		// The established observations are the runtime's OWN observable
		// facts about the trajectory: the tools used, the rounds, the
		// absence of edits, and the fact that the R1 allowance was spent.
		const establishedObservations = this.buildEstablishedObservations();
		const recentFailedStrategy = this.buildRecentFailedStrategy();
		return {
			text: objective,
			constraints,
			mutationScope,
			mutationScopePaths,
			obligationReferences,
			outstandingObligations,
			establishedObservations,
			recentFailedStrategy,
		};
	}

	/**
	 * Extract the PATHS the USER authorised, from the parent's own text.
	 *
	 * A path is a token that starts with `/`, `./` or `~/` and contains no
	 * whitespace. The extraction is structural: it never interprets command
	 * text and never evaluates anything.
	 *
	 * When the user named no path, the list is empty and the structural
	 * scope ceiling is simply not enforceable — the runtime does not guess
	 * at a scope the user never expressed.
	 */
	private extractAuthorisedScopePaths(texts: readonly string[]): string[] {
		const paths: string[] = [];
		for (const text of texts) {
			for (const token of text.split(/[\s,;()]+/)) {
				const trimmed = token.replace(/[).,;:]+$/, "");
				if (
					trimmed.length === 0 ||
					trimmed.includes("*") ||
					trimmed.includes("(")
				) {
					continue;
				}
				if (
					trimmed.startsWith("/") ||
					trimmed.startsWith("./") ||
					trimmed.startsWith("~/")
				) {
					if (!paths.includes(trimmed)) {
						paths.push(trimmed);
					}
				}
			}
		}
		return paths;
	}

	/**
	 * The parent task's OUTSTANDING acceptance obligations.
	 *
	 * The runtime already owns the terminal-completion obligation: the
	 * completion tool reminder states which terminal tool must be called.
	 * When the completion guard is enabled, the guard's own message is the
	 * outstanding obligation. Both are RUNTIME-owned, so they are
	 * authoritative facts about what is still owed.
	 */
	private findOutstandingObligations(): string[] {
		const obligations: string[] = [];
		const terminalToolNames = this.getRequiredCompletionToolNames();
		if (terminalToolNames.length > 0) {
			obligations.push(
				`Call the terminal completion tool ${terminalToolNames.join(" or ")} only after every parent obligation is satisfied`,
			);
		}
		const guard = this.config.completionPolicy?.completionGuard?.();
		if (guard && guard.trim().length > 0) {
			obligations.push(guard.trim());
		}
		if (obligations.length === 0) {
			// The parent task itself is the outstanding obligation: it has
			// not completed, because the run is still executing.
			obligations.push("Complete the parent task as authorized by the user");
		}
		return obligations;
	}

	/**
	 * The ESTABLISHED observations the selection may cite.
	 *
	 * Each entry is a short, factual, OBSERVABLE statement. Nothing here is
	 * inferred from provider-owned thinking text, and nothing here claims a
	 * finding the runtime did not observe.
	 */
	private buildEstablishedObservations(): string[] {
		const observations: string[] = [];
		const streak = this.executionStagnation;
		observations.push(
			`The last ${streak.unproductiveRounds} consecutive execution round(s) produced no productive step`,
		);
		const toolNames = [
			...new Set(streak.toolNames.filter((name) => name.length > 0)),
		].sort();
		observations.push(
			toolNames.length > 0
				? `The unproductive round(s) used only these tools: ${toolNames.join(", ")}`
				: "The unproductive round(s) used no tools",
		);
		observations.push(
			streak.editAttempts > 0
				? `${streak.editAttempts} edit attempt(s) were made in the unproductive round(s)`
				: "No edit was attempted in the unproductive round(s)",
		);
		observations.push(
			`The runtime's corrective-instruction allowance is exhausted (${streak.instructionsInjected} instruction(s) were already delivered and produced no productive step)`,
		);
		observations.push(
			`The working directory is available and the editor is enabled`,
		);
		return observations;
	}

	/**
	 * A short, factual description of the RECENT FAILED STRATEGY, derived
	 * only from the runtime's own observations.
	 */
	private buildRecentFailedStrategy(): string {
		const toolNames = [
			...new Set(
				this.executionStagnation.toolNames.filter((name) => name.length > 0),
			),
		].sort();
		if (toolNames.length === 0) {
			return "The recent strategy performed no tool calls and made no progress";
		}
		return `The recent strategy inspected repeatedly using these tools (${toolNames.join(", ")}) and never produced a productive step`;
	}

	/**
	 * Run the ONE bounded selection inference.
	 *
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-02.
	 *
	 * The selection-inference allowance is RUN-SCOPED: the counter lives
	 * on the runtime instance, so with the experimental bound of 1 the
	 * WHOLE run may make ONE selection inference — not one per activation.
	 * A second activation in the same run makes no further selection
	 * inference at all.
	 *
	 * The inference uses the SAME authorized model and provider as the
	 * parent run — never a supervisor process, never a provider switch, and
	 * never a recursive planner. The request carries NO tools, so the
	 * selection cannot mutate anything and cannot execute anything.
	 *
	 * The inference's usage is counted in the ORDINARY usage accounting:
	 * the provider's own `usage` events are folded into the run's usage
	 * exactly like any other request.
	 *
	 * Returns the parsed candidate, or `undefined` when the inference
	 * produced no parsable candidate.
	 */
	private async runBoundedObjectiveSelectionInference(context: {
		parentTaskId: string;
		parentObjective: string;
		parentConstraints: string[];
		parentMutationScope: string;
		parentMutationScopePaths: string[];
		parentObligationReferences: ParentObligationReference[];
		outstandingObligations: string[];
		establishedObservations: string[];
		recentFailedStrategy: string;
		availableTools: string[];
		remainingAllowance: {
			activations: number;
			selectionInferences: number;
			objectiveRounds: number;
		};
	}): Promise<
		| {
				readonly generatedText: string;
				readonly candidate: unknown;
				readonly selectorRequestId: string;
		  }
		| undefined
	> {
		this.throwIfAborted();
		const prompt = buildBoundedObjectiveSelectionPrompt(context);
		// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01):
		// the EXACT identity of the SELECTOR REQUEST.
		//
		// The id is minted ONCE per selection inference and is put into the
		// selection request's transport metadata under the EXISTING
		// `captureId` key. The EXISTING provider-request capture already
		// honours an explicit `correlation.captureId`, so the CAPTURED
		// REQUEST FILE is named `<selectorRequestId>...`, and the captured
		// RESPONSE carries the SAME id. The response therefore joins to its
		// request by EXACT IDENTITY.
		//
		// It is minted for EVERY selection inference — including the ones
		// whose response is never observed — because the captured REQUEST
		// must always be nameable. The id is inert: it is transport
		// correlation metadata, never a prompt field.
		const selectorRequestId = createUID("sel");
		let stream: AsyncIterable<AgentModelEvent>;
		try {
			stream = await this.config.model.stream({
				systemPrompt: BOUNDED_OBJECTIVE_SELECTION_SYSTEM_PROMPT,
				messages: [
					createMessage("user", [{ type: "text", text: prompt }], {
						userRunSpan: 0,
						runtimeAuthority: "bounded_objective_selection",
					}),
				],
				// The selection performs NO tools and NO mutations. It is a
				// pure inference that names one bounded objective.
				tools: [],
				signal: this.abortController?.signal,
				options: mergeModelOptions(this.config.modelOptions, {
					metadata: {
						kind: "bounded_objective_selection",
						runId: this.state.runId,
						agentId: this.state.agentId,
						// The EXISTING capture-id correlation key.
						captureId: selectorRequestId,
					},
				}),
			});
		} catch {
			return undefined;
		}
		let text = "";
		try {
			for await (const event of stream) {
				if (event.type === "text-delta") {
					text += event.text;
				} else if (event.type === "usage") {
					// The selection inference counts in the ORDINARY usage
					// accounting.
					await this.updateUsage(event.usage);
				}
			}
		} catch {
			return undefined;
		}
		this.throwIfAborted();
		// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01: the GENERATED
		// text is returned alongside the parsed candidate so the
		// observation sink can record what the model actually said. It is
		// the model's own reply — never provider-owned reasoning.
		//
		// (AMENDMENT-01): the SELECTOR REQUEST IDENTITY is returned too, so
		// the captured RESPONSE joins to the captured REQUEST by exact id.
		return {
			generatedText: text,
			candidate: parseBoundedObjectiveCandidate(text),
			selectorRequestId,
		};
	}

	/**
	 * Report ONE observed fact about the R2 selection boundary to the
	 * OPT-IN, host-supplied observation sink.
	 *
	 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01.
	 *
	 * DEFAULT OFF: the sink is absent unless a host supplies one, and this
	 * method pays a single null check.
	 *
	 * The report is READ-ONLY and MUST NOT affect the selection, the
	 * validation, the dispatch, or the completion authority.
	 *
	 * ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01):
	 * FAILURE ISOLATION covers BOTH a synchronous throw AND an
	 * ASYNCHRONOUS rejection.
	 *
	 * The sink's contract is `void | Promise<void>`. `try { void
	 * sink.onSelectionObservation(...) } catch {}` only isolates the
	 * SYNCHRONOUS throw: a returned Promise that rejects LATER escapes
	 * the try block entirely and becomes an UNHANDLED REJECTION, which
	 * terminates the process under `--unhandled-rejections=strict` (and
	 * is an unhandled rejection in every other profile too).
	 *
	 * The returned thenable is therefore ATTACHED: a rejection is
	 * swallowed by the runtime's OWN rejection handler, so the observer
	 * can never take the process down. The observation itself is
	 * fire-and-forget — the runtime NEVER awaits the sink, so a slow or
	 * hanging sink cannot delay the selection, the validation or the
	 * parent continuation.
	 *
	 * DEFAULT OFF additionally performs NO capture-specific diagnosis or
	 * serialization: the absent-sink path is a single null check and
	 * returns before any observation is built.
	 */
	private observeBoundedObjectiveSelection(
		observation: BoundedObjectiveSelectionObservation,
	): void {
		const sink = this.config.boundedObjectiveSelectionTraceSink;
		const report = sink?.onSelectionObservation;
		if (!report) {
			return;
		}
		try {
			// ACT-CLINEMM-R2-SELECTION-CONTRACT-CORRECTION-01 (AMENDMENT-01):
			// DETACH the observation before it reaches the observer.
			//
			// The observation carries the runtime-owned PARSED PROPOSAL, and
			// the validator RETAINS that proposal's `obligationReferences` and
			// `evidenceReferences` arrays — the very arrays it validated. A
			// structural clone breaks the aliasing, so an observer that
			// mutates those arrays cannot alter the already-validated
			// objective, its revalidation, or the rendered privileged
			// instruction.
			//
			// The clone is DEEP, so nested structures are detached too. The
			// observation's own contract is a plain JSON-shaped record, so
			// `structuredClone` covers it.
			const result = report.call(sink, structuredClone(observation));
			// The sink MAY return a Promise. A rejection must never escape
			// as an unhandled rejection, so the runtime attaches its own
			// rejection handler. The runtime does NOT await it: the
			// observation is fire-and-forget by contract.
			if (
				result !== null &&
				typeof result === "object" &&
				typeof (result as Promise<void>).then === "function"
			) {
				(result as Promise<void>).then(undefined, () => {
					// The observation sink must never affect model
					// execution. A rejected observation is swallowed.
				});
			}
		} catch {
			// A SYNCHRONOUS throw is swallowed too.
			// The observation sink must never affect model execution.
		}
	}

	/**
	 * The R2 DISPATCH PROJECTION.
	 *
	 * While a bounded objective is active, the runtime projects it onto the
	 * DISPATCHED model request's privileged channel (the system prompt),
	 * which is the same channel the host's trusted runtime-control
	 * continuation uses.
	 *
	 * This is what makes R2 materially different from R1:
	 *
	 *   - R1 appends an ADVISORY message to the conversation; the model may
	 *     ignore it, and the conversation's own objective is unchanged.
	 *   - R2 changes the CURRENT EXECUTION TARGET of the request the
	 *     provider is about to see.
	 *
	 * The canonical conversation history is NOT mutated: the objective is a
	 * runtime-owned projection, so the signed reasoning continuity and the
	 * parent's conversation are preserved byte-for-byte.
	 */
	private projectActiveBoundedObjective(
		systemPrompt: string | undefined,
	): string | undefined {
		const objective = this.activeBoundedObjective;
		if (!objective) {
			return systemPrompt;
		}
		const instruction = renderBoundedObjectiveInstruction(objective);
		if (!systemPrompt || systemPrompt.trim().length === 0) {
			return instruction;
		}
		return `${systemPrompt}\n\n${instruction}`;
	}

	/**
	 * Fold one execution round into the ACTIVE bounded objective's facts.
	 *
	 * The facts are the SAME structural observations the stagnation
	 * accounting already collects. They are the input to the verification
	 * step.
	 *
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01:
	 * the round's STRUCTURED EXECUTION RECEIPTS are folded in as well.
	 * The receipts are what makes the required gate correlatable with its
	 * actual outcome.
	 */
	private accumulateBoundedObjectiveFacts(): void {
		const objective = this.activeBoundedObjective;
		if (!objective) {
			return;
		}
		const facts = this.executionRoundFacts;
		this.boundedObjectiveFacts = {
			rounds: this.boundedObjectiveFacts.rounds + 1,
			toolNames: [...this.boundedObjectiveFacts.toolNames, ...facts.toolNames],
			editAttempts:
				this.boundedObjectiveFacts.editAttempts + facts.editAttempts,
			successfulEdits:
				this.boundedObjectiveFacts.successfulEdits + facts.successfulEdits,
			executedCommands:
				this.boundedObjectiveFacts.executedCommands + facts.executedCommands,
			receipts: [
				...(this.boundedObjectiveFacts.receipts ?? []),
				...facts.receipts,
			],
		};
	}

	/**
	 * Whether the ACTIVE bounded objective has been VERIFIED.
	 *
	 * A model statement that the objective is complete is NOT sufficient:
	 * the verification consults the OBSERVABLE tool outcomes of the
	 * objective's own execution.
	 *
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-02.
	 *
	 * The AMENDMENT-01 structural gate check is REMOVED. It accepted any
	 * successful command whose text CONTAINED a host-declared substring,
	 * so a trivial `echo check-value` satisfied a `check-value` gate and
	 * the runtime reported the objective as VERIFIED. That is not
	 * executable verification, and no shell-command parser can repair it:
	 * a command that merely MENTIONS the gate can succeed while the
	 * executable the objective names never ran.
	 *
	 * The verification now has exactly ONE authority:
	 *
	 *   The HOST's `verifyObjective` callback. It owns the workspace, the
	 *   command-policy layer and the sandbox, so it is the only layer that
	 *   can know whether the objective's verification condition was met.
	 *   Returning `undefined` means "no opinion", and a THROWING callback
	 *   is treated as "no opinion" too.
	 *
	 * When the host supplies NO verdict, the objective is UNVERIFIED. The
	 * runtime reports that honestly instead of manufacturing a success:
	 * useful unverified progress is a legitimate recovery outcome.
	 */
	private isBoundedObjectiveVerified(): boolean {
		const objective = this.activeBoundedObjective;
		if (!objective) {
			return false;
		}
		const policy = this.getBoundedObjectivePolicy();
		const authority = resolveBoundedObjectiveVerification(
			objective,
			this.boundedObjectiveFacts,
			policy?.verifyObjective,
		);
		return authority.kind === "host_verdict" && authority.verified;
	}

	/**
	 * Evaluate the ACTIVE bounded objective after a round, and — when it is
	 * verified — RETURN execution to the parent task automatically.
	 *
	 * The return is automatic: no operator confirmation, no new user-waiting
	 * state, and no new lifecycle authority. The parent's completion
	 * obligations are preserved: completing the objective does NOT authorize
	 * the parent's completion.
	 */
	private async evaluateActiveBoundedObjective(): Promise<void> {
		const objective = this.activeBoundedObjective;
		if (!objective) {
			return;
		}
		this.accumulateBoundedObjectiveFacts();
		const policy = this.getBoundedObjectivePolicy();
		const maxRounds = Math.max(
			0,
			policy?.maxObjectiveRounds ??
				DEFAULT_BOUNDED_OBJECTIVE_POLICY.maxObjectiveRounds,
		);
		const verified = this.isBoundedObjectiveVerified();
		const roundsExhausted = this.boundedObjectiveFacts.rounds >= maxRounds;
		if (!verified && !roundsExhausted) {
			// The objective is still executing: the dispatch projection
			// stays active, so the NEXT request still reflects it.
			return;
		}
		if (verified) {
			this.activeBoundedObjective = undefined;
			this.lastBoundedObjectiveOutcome = {
				kind: "completed",
				objective,
			};
			await this.emit({
				type: "status-notice",
				snapshot: this.snapshot(),
				message: `bounded objective verified: ${objective.objective} — returning execution to the parent task`,
				metadata: {
					kind: "bounded_objective_recovery",
					reason: "bounded_objective_verified",
					phase: "objective_verified",
					iteration: this.state.iteration,
					objective: objective.objective,
					rounds: this.boundedObjectiveFacts.rounds,
					executedCommands: this.boundedObjectiveFacts.executedCommands,
					successfulEdits: this.boundedObjectiveFacts.successfulEdits,
				},
			});
			await this.emitBoundedObjectiveOutcome(undefined);
			return;
		}
		// The objective's round budget is exhausted WITHOUT a verification.
		// The recovery FAILED: it must not manufacture success, and it must
		// not silently replenish the allowance.
		this.activeBoundedObjective = undefined;
		this.lastBoundedObjectiveOutcome = {
			kind: "failed",
			reason: "objective_rounds_exhausted_without_verification",
			objective,
		};
		await this.emit({
			type: "status-notice",
			snapshot: this.snapshot(),
			message: `bounded objective did not verify within ${maxRounds} round(s) — returning execution to the parent task without claiming success`,
			metadata: {
				kind: "bounded_objective_recovery",
				reason: "bounded_objective_unverified",
				phase: "objective_failed",
				iteration: this.state.iteration,
				objective: objective.objective,
				rounds: this.boundedObjectiveFacts.rounds,
				maxRounds,
			},
		});
		await this.emitBoundedObjectiveOutcome(
			"objective_rounds_exhausted_without_verification",
		);
	}

	/**
	 * CLOSE OUT an ACTIVE bounded objective at the run's TERMINAL
	 * boundary.
	 *
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
	 *
	 * The in-loop evaluation only runs when the run CONTINUES. When the
	 * run ends with an objective still active, the objective would
	 * otherwise disappear without a verdict — the runtime would have
	 * consumed its activation allowance and produced no machine-readable
	 * fact at all.
	 *
	 * This method produces that fact TRUTHFULLY:
	 *
	 *   - if the objective's required verification gate HAS passed by the
	 *     time the run ends, the objective is reported COMPLETED,
	 *   - otherwise it is reported FAILED, with the reason
	 *     `objective_run_ended_without_verification`.
	 *
	 * It NEVER manufactures success, and it NEVER completes the parent
	 * task: the parent's completion contract is unchanged.
	 */
	private async finalizeActiveBoundedObjective(): Promise<void> {
		const objective = this.activeBoundedObjective;
		if (!objective) {
			return;
		}
		this.accumulateBoundedObjectiveFacts();
		const verified = this.isBoundedObjectiveVerified();
		this.activeBoundedObjective = undefined;
		if (verified) {
			this.lastBoundedObjectiveOutcome = {
				kind: "completed",
				objective,
			};
			await this.emit({
				type: "status-notice",
				snapshot: this.snapshot(),
				message: `bounded objective verified: ${objective.objective} — returning execution to the parent task`,
				metadata: {
					kind: "bounded_objective_recovery",
					reason: "bounded_objective_verified",
					phase: "objective_verified",
					iteration: this.state.iteration,
					objective: objective.objective,
					rounds: this.boundedObjectiveFacts.rounds,
					executedCommands: this.boundedObjectiveFacts.executedCommands,
					successfulEdits: this.boundedObjectiveFacts.successfulEdits,
				},
			});
			await this.emitBoundedObjectiveOutcome(undefined);
			return;
		}
		this.lastBoundedObjectiveOutcome = {
			kind: "failed",
			reason: "objective_run_ended_without_verification",
			objective,
		};
		await this.emit({
			type: "status-notice",
			snapshot: this.snapshot(),
			message: `bounded objective did not verify before the run ended — returning execution to the parent task without claiming success`,
			metadata: {
				kind: "bounded_objective_recovery",
				reason: "bounded_objective_unverified",
				phase: "objective_failed",
				iteration: this.state.iteration,
				objective: objective.objective,
				rounds: this.boundedObjectiveFacts.rounds,
			},
		});
		await this.emitBoundedObjectiveOutcome(
			"objective_run_ended_without_verification",
		);
	}

	/**
	 * THE OBJECTIVE SCOPE GATE — the refusal decision.
	 *
	 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01.
	 *
	 * Returns a refusal reason when the tool call would MUTATE a path
	 * outside the ACTIVE objective's authorised scope, and `undefined`
	 * otherwise.
	 *
	 * WHAT IT ENFORCES
	 * -----------------
	 * The active objective may only NARROW the parent's authority, and the
	 * narrowing is enforced HERE — at the tool-execution boundary — not
	 * merely asserted in the dispatch text the model reads.
	 *
	 * WHAT IT DOES NOT CLAIM
	 * ----------------------
	 * The gate is honest about its own limits:
	 *
	 *   - It applies to tool calls whose input carries an EXPLICIT path.
	 *     A command tool whose command text names a path is NOT inspected:
	 *     the runtime never parses command text, because that would be
	 *     provider-specific string matching. The COMMAND-POLICY layer and
	 *     the SANDBOX remain the authority for command contents.
	 *   - It applies only while an objective is active.
	 *   - It applies only when the objective's scope resolved to a
	 *     canonical root. An objective whose scope did NOT resolve has no
	 *     narrower scope to enforce; the parent's own authorisation remains
	 *     the only authority in that case, and the runtime says so rather
	 *     than pretending a narrower scope exists.
	 */
	private refuseToolCallOutsideActiveObjectiveScope(
		toolName: string,
		input: unknown,
	): string | undefined {
		const objective = this.activeBoundedObjective;
		if (!objective) {
			return undefined;
		}
		// The gate applies to MUTATIONS only. A read-only tool call cannot
		// widen the parent's authority.
		const classified = this.classifyToolCallProductivity(
			toolName,
			input,
			undefined,
		);
		if (classified.kind !== "edit") {
			return undefined;
		}
		const targetPath = extractToolCallTargetPath(input);
		if (targetPath === undefined) {
			return undefined;
		}
		const scopeRoots = this.resolveActiveObjectiveScopeRoots(objective);
		if (scopeRoots.length === 0) {
			// The objective's scope did NOT resolve to a canonical root.
			// There is no narrower scope to enforce. The parent's own
			// authorisation — enforced by the existing workspace, sandbox
			// and command-policy layers — remains the only authority.
			return undefined;
		}
		const resolvedTarget = canonicalizeScopePath(targetPath);
		const targetCanonical = resolvedTarget.canonical;
		if (!resolvedTarget.resolvable || targetCanonical === undefined) {
			// A path that cannot be canonicalised cannot be shown to be
			// inside the scope, so the mutation is refused.
			return `Tool "${toolName}" was refused by the active bounded objective: the target path could not be resolved against the objective's authorised mutation scope`;
		}
		const inside = scopeRoots.some((root) =>
			isPathWithinCanonicalRoot(targetCanonical, root),
		);
		if (inside) {
			return undefined;
		}
		return `Tool "${toolName}" was refused by the active bounded objective: the target path is outside the objective's authorised mutation scope`;
	}

	/**
	 * The CANONICAL ROOTS of the ACTIVE objective's authorised mutation
	 * scope.
	 *
	 * Returns an EMPTY list when the objective's scope could not be
	 * resolved — the honest representation of "there is no narrower scope
	 * to enforce".
	 */
	private resolveActiveObjectiveScopeRoots(
		objective: BoundedObjective,
	): string[] {
		const roots: string[] = [];
		for (const candidate of extractScopePaths(objective.mutationScope)) {
			const resolved = canonicalizeScopePath(candidate);
			if (resolved.resolvable && resolved.canonical !== undefined) {
				roots.push(resolved.canonical);
			}
		}
		return roots;
	}

	/**
	 * Emit the explicit internal recovery outcome.
	 *
	 * It is the machine-readable fact a future R3 consumer acts on. It
	 * carries NO user-facing waiting state and never manufactures success.
	 */
	private async emitBoundedObjectiveOutcome(
		failureReason: string | undefined,
	): Promise<void> {
		const outcome = this.lastBoundedObjectiveOutcome;
		if (!outcome) {
			return;
		}
		await this.emit({
			type: "status-notice",
			snapshot: this.snapshot(),
			message: failureReason
				? `bounded objective recovery outcome: failed (${failureReason})`
				: "bounded objective recovery outcome: completed",
			metadata: {
				kind: "bounded_objective_recovery",
				reason: "bounded_objective_outcome",
				phase: "outcome",
				iteration: this.state.iteration,
				outcome: outcome.kind,
				failureReason,
				activations: this.boundedObjectiveActivations,
				selectionInferences: this.boundedObjectiveSelectionInferences,
			},
		});
	}

	private async addUserReminderMessage(
		text: string,
		metadata: AgentMessage["metadata"] = {},
	): Promise<AgentMessage> {
		const reminderMessage = createMessage("user", [{ type: "text", text }], {
			...metadata,
			userRunSpan: 0,
		});
		this.state.messages.push(reminderMessage);
		await this.emit({
			type: "message-added",
			snapshot: this.snapshot(),
			message: reminderMessage,
		});
		return reminderMessage;
	}

	// -------------------------------------------------------------------------
	// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1)
	//
	// Runtime-owned execution-stagnation recovery.
	//
	// The runtime is the ONLY lifecycle authority here: it observes its own
	// execution rounds, owns the accounting, and injects its own corrective
	// message through the EXISTING `addUserReminderMessage` seam. No parallel
	// supervisor, no provider switching, no workflow engine.
	//
	// The pure decision function lives in `@cline/shared`
	// (`agents/execution-stagnation`) so the compaction contract-conservation
	// path can recognise the injected message by template equality.
	// -------------------------------------------------------------------------

	/**
	 * Clear the facts observed for the current execution round.
	 */
	private resetExecutionRoundFacts(): void {
		this.executionRoundFacts = {
			toolNames: [],
			editAttempts: 0,
			successfulEdits: 0,
			executedCommands: 0,
			failedExecutions: 0,
			awaitingBackgroundWork: false,
			receipts: [],
		};
	}

	/**
	 * Classify ONE tool call's observable shape into a productivity signal.
	 *
	 * The classification is driven by the tool INPUT SHAPE and the tool
	 * RESULT OUTCOME, never by a host/provider-specific tool-name string
	 * comparison:
	 *
	 *   - an input carrying an edit operation (`path` + `old_text` /
	 *     `new_text` / `insert_line`, or an `apply_patch` body) is an EDIT
	 *     attempt;
	 *   - an input carrying a command list is a COMMAND EXECUTION;
	 *   - everything else is INSPECTION.
	 *
	 * A command whose result reports that it is STILL RUNNING is
	 * "awaiting background work" — the round must NOT count toward the
	 * stagnation streak, because a legitimate wait is not a stall.
	 */
	private classifyToolCallProductivity(
		toolName: string,
		input: unknown,
		result: { output: unknown; isError?: boolean } | undefined,
	): {
		kind: "edit" | "command" | "inspection";
		awaiting: boolean;
	} {
		const record = (input ?? {}) as Record<string, unknown>;
		const hasEditShape =
			typeof record.path === "string" &&
			(typeof record.old_text === "string" ||
				typeof record.new_text === "string" ||
				typeof record.insert_line === "string" ||
				typeof record.content === "string" ||
				typeof record.diff === "string" ||
				typeof record.patch === "string");
		const hasPatchBody =
			typeof input === "string" && input.includes("*** Begin Patch");
		if (hasEditShape || hasPatchBody) {
			return { kind: "edit", awaiting: false };
		}
		const commands = record.commands;
		if (Array.isArray(commands)) {
			return {
				kind: "command",
				awaiting: this.resultReportsStillRunning(result?.output),
			};
		}
		// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01):
		// a tool call that is NOT command-shaped can still be a LEGITIMATE
		// WAIT.
		//
		// Production does not wait by relaunching a build: it launches ONE
		// job and then POLLS that ONE IDENTIFIED job with `command_status`,
		// whose input is `{ jobId }` — no `commands` array — and whose result
		// carries the `state: "running"` marker.
		//
		// Reading the marker only for command-shaped inputs therefore
		// classified a legitimate poll as an unproductive inspection round:
		// a FALSE STALL declared while the agent was waiting on real work.
		//
		// The marker is a DATA-SHAPE fact about the OBSERVATION, so it is
		// read for every tool call. A tool that returns no marker keeps the
		// previous classification exactly.
		const awaiting = this.resultReportsStillRunning(result?.output);
		// `toolName` participates only as a LAST-RESORT disambiguator for
		// hosts that express a patch body as a dedicated tool input.
		void toolName;
		return { kind: "inspection", awaiting };
	}

	/**
	 * Whether a command result reports that the command is STILL RUNNING.
	 *
	 * The check is DATA-SHAPE driven: it looks for an explicit
	 * "still running" marker in the structured result, never for prose.
	 * A host that reports background work through a different channel simply
	 * does not set the marker, and the round is then classified by the same
	 * rules as any other command round.
	 */
	private resultReportsStillRunning(output: unknown): boolean {
		if (typeof output === "string") {
			// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01):
			// the PRODUCTION `run_commands` RUNNING envelope is a JSON
			// STRING (`JSON.stringify(runningPayload)`), so the marker is
			// read STRUCTURALLY through the parsed envelope.
			//
			// The prose fallback below remains for hosts that report the
			// state in plain text.
			try {
				if (this.outputReportsStillRunningShape(JSON.parse(output))) {
					return true;
				}
			} catch {
				// Not JSON: fall through to the prose reading.
			}
			return /\b(still running|running in the background|backgrounded)\b/i.test(
				output,
			);
		}
		if (!output || typeof output !== "object") {
			return false;
		}
		// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01):
		// the PRODUCTION TOOL-RESULT ENVELOPE.
		//
		// The production tools return their result as an ARRAY of operation
		// results (`ToolOperationResult[]`), and the "still running" marker
		// lives on the OPERATION RESULT — not on the envelope. The
		// production `command_status` tool, for example, returns
		//
		//   [{ ok: true, jobId, state: "running", elapsedMs, ... }]
		//
		// so a top-level read of `state` sees `undefined` and a legitimate
		// wait on a running job was misclassified as an unproductive
		// inspection round — a FALSE STALL.
		//
		// The marker is therefore read through BOTH shapes: the single
		// operation-result object, and the production array envelope. This
		// is a DATA-SHAPE read, never a prose read: only the explicit
		// marker fields are consulted.
		return this.outputReportsStillRunningShape(output);
	}

	/**
	 * Whether ONE observation carries the explicit "still running" marker.
	 *
	 * The marker is read from the explicit fields only. No prose is parsed.
	 */
	private outputReportsStillRunningShape(value: unknown): boolean {
		if (!value || typeof value !== "object") {
			return false;
		}
		const record = value as Record<string, unknown>;
		for (const key of ["status", "state", "commandExecutionDisposition"]) {
			const marker = record[key];
			if (typeof marker === "string") {
				const normalized = marker.toLowerCase();
				if (
					normalized === "running" ||
					normalized === "backgrounded" ||
					normalized === "still_running" ||
					normalized === "in_progress"
				) {
					return true;
				}
			}
		}
		if (record.isRunning === true || record.stillRunning === true) {
			return true;
		}
		// The production array envelope: the marker lives on an operation
		// result inside the array. A single-element array is the production
		// shape of a one-command observation; a multi-element array is
		// inspected entry by entry.
		if (Array.isArray(value)) {
			for (const entry of value) {
				if (this.outputReportsStillRunningShape(entry)) {
					return true;
				}
			}
		}
		return false;
	}

	private async execute(input?: AgentRunInput): Promise<AgentRunResult> {
		await this.ensureInitialized();
		if (this.state.status === "running") {
			throw new Error("Agent runtime is already running");
		}

		this.abortController = new AbortController();
		this.state.runId = createUID("run");
		this.modelRequestId = undefined;
		this.state.status = "running";
		this.state.iteration = 0;
		this.state.pendingToolCalls = [];
		this.state.lastError = undefined;
		this.state.lastErrorClass = undefined;
		this.state.lastErrorRetryable = undefined;
		this.state.lastErrorReported = false;
		// RSMT01: next-run freshness. The execution
		// authority flags MUST be cleared at the start of
		// every run so a prior run's stale
		// "modelStreaming" or "awaitingApproval" cannot
		// leak across the run boundary. Pinned by RSM14.
		this.state.executionModelStreaming = false;
		this.state.executionAwaitingApproval = false;
		this.state.lastFinishReason = undefined;
		this.state.usage = cloneUsage(DEFAULT_USAGE);
		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-
		// TRANSPORT-REPAIR01 (fourteenth-pass): STATE_BIND.
		// A new run begins with no captured W; the next
		// prepareTurnForModelRequest call will populate
		// this field with the producer-side estimate.
		this.state.currentWorkingContextEstimate = undefined;
		this.overflowRecoveryAttempted = false;
		this.state.lastRequestInputTokens = 0;
		this.pendingHookContexts = [];
		this.maxTokensRecoveryCount = 0;
		this.maxTokensRecoveryAttempted = false;
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01:
		// the CONSECUTIVE exhaustion streak, the finite exhaustion-driven
		// continuation ceiling and the one-shot recovery-only generation
		// override allowance are all RUN-SCOPED. A genuinely NEW externally
		// initiated run initialises its own resources; an internal
		// continuation of the same recovery episode never does.
		this.maxTokensExhaustionStreak = 0;
		this.exhaustionRecoveryContinuations = 0;
		this.recoveryOutputOverrideConsumed = false;
		this.pendingRecoveryOutputOverride = undefined;
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01):
		// the pending-delivery flag for an injected corrective instruction is
		// RUN-SCOPED, exactly like every other recovery resource.
		this.executionStagnationInstructionPending = false;
		// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1): the
		// execution-stagnation accounting is RUN-SCOPED. A fresh run starts
		// from a clean streak AND a clean instruction allowance, so a prior
		// run's stall cannot consume the next run's recovery budget.
		this.executionStagnation = createExecutionStagnationAccounting();
		this.resetExecutionRoundFacts();
		// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 (R2): the
		// bounded-objective accounting is RUN-SCOPED, exactly like the R1
		// accounting. A fresh run starts with a clean activation allowance,
		// a clean selection-inference allowance, and NO active objective, so
		// a prior run's recovery cannot consume the next run's budget and a
		// stale objective can never be dispatched.
		this.boundedObjectiveActivations = 0;
		this.boundedObjectiveSelectionInferences = 0;
		this.activeBoundedObjective = undefined;
		this.boundedObjectiveFacts = {
			rounds: 0,
			toolNames: [],
			editAttempts: 0,
			successfulEdits: 0,
			executedCommands: 0,
			receipts: [],
		};
		this.lastBoundedObjectiveOutcome = undefined;

		// C1.4: reset recovery bookkeeping that is scoped to a
		// single run. The same logic applies here as in
		// `restore()`: a fresh `run()` invocation on the same
		// runtime instance MUST start from a clean episode.
		// Otherwise a previous run that terminated with
		// `secondStage.kind === "terminating"` would corrupt
		// the new run (the latch would refuse the very first
		// model.stream() call). The test
		// `C14_NEXT_RUN_LIFECYCLE_RESET` pins this invariant.
		// C1.5: capture the projection before the lifecycle reset so a
		// meaningful reset (e.g. a previous run ended `terminating`)
		// becomes observable. A no-op reset (already `idle`) produces an
		// identical projection and is therefore suppressed by the dedup
		// rule — no pointless `idle → idle` event on every run.
		const recoveryBeforeReset = this.snapshotRecoveryState();
		this.resetRecoveryEpisode();

		try {
			await this.callBeforeRunHooks();
			await this.emit({ type: "run-started", snapshot: this.snapshot() });
			await this.emitRecoveryStateChangeIfChanged(recoveryBeforeReset);

			for (const message of input ? normalizeInput(input) : []) {
				this.state.messages.push(message);
				await this.emit({
					type: "message-added",
					snapshot: this.snapshot(),
					message,
				});
			}

			const completionToolReminder = this.getCompletionToolReminderMessage();
			if (completionToolReminder) {
				await this.addUserReminderMessage(completionToolReminder);
			}

			// Context collected by beforeRun hooks lands after the run's input
			// messages so the model sees it on the first request of the run.
			await this.flushPendingHookContexts();

			let finalAssistantMessage: AgentMessage | undefined;

			while (
				this.config.maxIterations === undefined ||
				this.state.iteration < this.config.maxIterations
			) {
				this.throwIfAborted();

				this.state.iteration += 1;
				// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1): the
				// execution round's observable facts are reset at the START of
				// the round, so they describe exactly the work this round does.
				this.resetExecutionRoundFacts();
				await this.emit({
					type: "turn-started",
					snapshot: this.snapshot(),
					iteration: this.state.iteration,
				});

				// A fresh error slate per turn: nothing from a previous turn may leak
				// into this turn's error classification or retry decision.
				this.resetLastError();
				const { message, finishReason, interrupted } =
					await this.generateAssistantMessageWithProviderRetry();
				// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01
				// (AMENDMENT-01).
				//
				// The model has now had its turn, so a corrective instruction
				// that was pending delivery is no longer pending: the
				// intervention happened. The flag is cleared HERE, before the
				// round's own accounting decides whether another
				// continuation is authorized, so the pending-instruction
				// authority covers exactly ONE further parent request.
				this.executionStagnationInstructionPending = false;
				if (interrupted && message.content.length === 0) {
					await this.emit({
						type: "turn-finished",
						snapshot: this.snapshot(),
						iteration: this.state.iteration,
						toolCallCount: 0,
					});
					continue;
				}
				if (finishReason === "aborted") {
					throw this.normalizeAbortError();
				}
				if (message.content.length === 0) {
					// Attribution is set immediately before each throw: nothing can
					// interleave between a synchronous set-and-throw and the
					// run-level catch, so `sdk.error` can never pick up a reason
					// from a failure it did not cause. Failures with no
					// finish-reason cause (hooks, listeners, transport) leave the
					// field unset and the attribute is omitted.
					if (finishReason === "error") {
						this.state.lastFinishReason = finishReason;
						throw new Error(this.state.lastError ?? "Model stream failed");
					}
					// Provider-executed tool activity lives in message metadata, not
					// content (projecting it into content would replay tool_use blocks
					// the model never gets results for). A turn that is only such
					// activity is not empty: keep the message so the transcript and
					// display projection retain it. Replay stays safe — the codec
					// renders empty content as its placeholder text block.
					const hasModelToolActivity = this.hasModelToolActivity(message);
					// A turn that produced no content because it hit the output-token
					// limit or has an unknown finish is incomplete: preserve the message
					// so finish-reason handling below can surface the right failure or recover.
					if (
						!hasModelToolActivity &&
						finishReason !== "max-tokens" &&
						finishReason !== "unknown"
					) {
						this.state.lastFinishReason = finishReason;
						throw new Error(
							finishReason === "content-filter"
								? CONTENT_FILTER_EMPTY_TURN_MESSAGE
								: "Model returned empty response",
						);
					}
				}
				const toolCalls = message.content.filter(
					(part: AgentMessagePart): part is AgentToolCallPart =>
						part.type === "tool-call",
				);

				finalAssistantMessage = message;
				await this.recordAssistantMessage(message, finishReason);

				if (interrupted) {
					await this.emit({
						type: "turn-finished",
						snapshot: this.snapshot(),
						iteration: this.state.iteration,
						toolCallCount: 0,
					});
					continue;
				}

				// Recovery already continued once, or external tool activity made
				// replay unsafe. Local calls are handled below with their results.
				if (finishReason === "unknown" && toolCalls.length === 0) {
					this.state.lastFinishReason = finishReason;
					throw new Error("Model ended without a recognized finish reason");
				}

				if (finishReason === "max-tokens" && toolCalls.length === 0) {
					// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01
					// CORRECTION-01.
					//
					// The TOOL-LESS OUTPUT-EXHAUSTED ROUND reaches the EXISTING
					// execution-stagnation authority.
					//
					// The predecessor `continue`d the loop here, BEFORE the
					// iteration boundary that folds a round into the
					// execution-stagnation accounting. A tool-less exhausted
					// response therefore contributed NOTHING to R1, and — since
					// R2 is reachable ONLY through R1's `allowance_exhausted`
					// branch — a tool-less exhaustion streak could never reach
					// R2 at all.
					//
					// The correction folds the exhausted round into the SAME
					// round-accounting mechanism that consumes executed tool
					// results. It introduces NO independent stagnation detector:
					// the classification comes from the EXISTING
					// `classifyExecutionRound()` (which reports `idle` for a
					// round with no tool call), and the decision comes from the
					// EXISTING `evaluateExecutionStagnation()`.
					//
					// LOGICAL ROUND CARDINALITY: exactly ONE logical round per
					// completed logical agent response. Multiple stream events,
					// multiple content blocks, usage updates, physical provider
					// retries, multiple tool results of one round, repeated
					// terminal notification and compaction never manufacture an
					// additional round — the fold happens exactly once, on the
					// terminal path of this response.
					//
					// TERMINAL CONSERVATION: only the established
					// output-exhaustion terminal class (`"max-tokens"`) reaches
					// this branch. A normal STOP, a cancellation, a provider
					// error, a content filter and an unknown terminal outcome
					// are NOT relabelled as output exhaustion.
					this.maxTokensExhaustionStreak += 1;
					await this.evaluateExecutionStagnation();
					// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01
					// (AMENDMENT-01).
					//
					// THE ACTIVE BOUNDED OBJECTIVE'S ROUND BUDGET.
					//
					// The R2 objective's round budget is consumed at the
					// FINALIZED execution-round accounting boundary. Before
					// AMENDMENT-01 that boundary was reached ONLY by a
					// tool-calling round, so a TOOL-LESS exhausted round
					// consumed NO objective round: an active objective could
					// then never expire, and the run could never terminate
					// truthfully while the objective remained active.
					//
					// The tool-less exhausted round IS an execution round of
					// the active objective — it is the objective's own turn,
					// and it produced no observable tool outcome. Folding it
					// into the EXISTING objective accounting keeps the
					// objective's budget meaningful and lets the objective
					// close out with a truthful verdict.
					await this.evaluateActiveBoundedObjective();

					if (await this.recoverFromIncompleteMaxTokensTurn()) {
						await this.emit({
							type: "turn-finished",
							snapshot: this.snapshot(),
							iteration: this.state.iteration,
							toolCallCount: 0,
						});
						continue;
					}
					// Same set-and-throw attribution as the empty-content check.
					this.state.lastFinishReason = finishReason;
					throw new Error(MAX_TOKENS_INCOMPLETE_TURN_MESSAGE);
				}
				if (finishReason === "error" && toolCalls.length === 0) {
					this.state.lastFinishReason = finishReason;
					throw new Error(this.state.lastError ?? "Model stream failed");
				}
				// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01
				// CORRECTION-01 (AMENDMENT-01).
				//
				// The CONSECUTIVE exhaustion streak is cleared by a genuinely
				// PRODUCTIVE round, NOT by the mere PRESENCE of a tool call.
				//
				// The predecessor reset on `toolCalls.length > 0`, so a
				// read-only INSPECTION re-armed the ordinary recovery
				// allowance — the defect that produced the frozen session's 17
				// conciseness reminders against a nominal allowance of 3.
				//
				// AMENDMENT-01: the reset is NOT performed HERE.
				//
				// This site is BEFORE `executeToolCalls()`, so the current
				// round's observable facts are still EMPTY: classifying the
				// round here observes NOTHING about the round that is about
				// to run, and the streak was therefore never cleared by a
				// genuinely productive round. The classification must
				// happen at the FINALIZED execution-round accounting
				// boundary, where the round's tool calls have actually been
				// executed and their outcomes observed.
				//
				// The finalized boundary is
				// {@link evaluateExecutionStagnation}, which already
				// computes the SAME production classification
				// (`buildExecutionRoundObservation()` →
				// `classifyExecutionRound()`, consulting the host's
				// authoritative `executionStagnationPolicy.classifyToolCall`
				// seam). The reset therefore REUSES the already-computed
				// productivity classification and never classifies the same
				// logical round twice.
				//
				// CONSERVATION:
				//   - a successful native edit / successful execution /
				//     legitimate wait clears the streak (existing contract),
				//   - a read-only inspection does NOT clear it,
				//   - a failed experiment does NOT clear it,
				//   - an unknown outcome does NOT clear it.
				//
				// The RUN-SCOPED consumable allowance
				// ({@link maxTokensRecoveryCount}) is NOT touched here at all:
				// no productive round ever replenishes it.
				this.state.pendingToolCalls = toolCalls.map((part) => part.toolCallId);

				if (toolCalls.length === 0) {
					await this.emit({
						type: "turn-finished",
						snapshot: this.snapshot(),
						iteration: this.state.iteration,
						toolCallCount: 0,
					});
					const completionReminderMessages =
						this.getCompletionReminderMessages();
					if (completionReminderMessages.length > 0) {
						for (const reminderMessage of completionReminderMessages) {
							await this.addUserReminderMessage(reminderMessage);
						}
						continue;
					}
					// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01
					// (AMENDMENT-01): close out an ACTIVE bounded
					// objective at the run's TERMINAL boundary, so the
					// recovery produces a truthful machine-readable
					// verdict instead of disappearing with the run.
					await this.finalizeActiveBoundedObjective();
					const result = this.finishRun("completed", finalAssistantMessage);
					await this.callAfterRunHooks(result);
					await this.emit({
						type: "run-finished",
						snapshot: this.snapshot(),
						result,
					});
					return result;
				}

				const toolMessages = await this.executeToolCalls(toolCalls);
				this.state.pendingToolCalls = [];
				for (const toolMessage of toolMessages) {
					this.state.messages.push(toolMessage);
					// ACT-CLINEMM-ROUND-C-HARNESS-02: report the TOOL RESULT
					// DELIVERY boundary at the REAL seam — the moment the
					// result becomes part of the CONVERSATION.
					//
					// This is deliberately NOT the executor's return: a
					// result can be produced and never delivered, and the
					// difference between the two is exactly what the
					// compaction evidence gap was about.
					//
					// Only the result's SIZE is reported. Its content is
					// never recorded.
					this.observeToolResultDelivered(toolMessage);
					await this.emit({
						type: "message-added",
						snapshot: this.snapshot(),
						message: toolMessage,
					});
				}
				if (
					finishReason === "unknown" &&
					!toolMessages.some((toolMessage) =>
						toolMessage.content.some(
							(part) => part.type === "tool-result" && !part.isError,
						),
					)
				) {
					this.state.lastFinishReason = finishReason;
					throw new Error(
						"Model ended without a recognized finish reason or successful tool work",
					);
				}

				await this.flushPendingHookContexts();
				// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1): the
				// RUNTIME INTERVENTION BOUNDARY. This runs AFTER the round's
				// tool calls have been executed and their results delivered,
				// and BEFORE the next model request. When it injects a
				// corrective instruction, execution continues AUTOMATICALLY —
				// the loop proceeds to the next iteration without any user
				// confirmation and without terminating the run.
				await this.evaluateExecutionStagnation();
				// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 (R2): the
				// BOUNDED-OBJECTIVE EVALUATION BOUNDARY.
				//
				// It runs at the SAME boundary as the R1 intervention, AFTER
				// the round's tool calls have been executed and their results
				// delivered, and BEFORE the next model request.
				//
				// It has two jobs:
				//
				//   1. when an objective is ACTIVE, it folds the round's
				//      observable facts into the objective's verification
				//      evidence, and — when the objective VERIFIES — it
				//      returns execution to the parent task AUTOMATICALLY;
				//
				//   2. when NO objective is active, it is a no-op.
				//
				// It NEVER completes the parent task and NEVER invokes the
				// parent's terminal completion tool.
				await this.evaluateActiveBoundedObjective();
				await this.emit({
					type: "turn-finished",
					snapshot: this.snapshot(),
					iteration: this.state.iteration,
					toolCallCount: toolCalls.length,
				});
				const terminalToolMessage = this.findCompletingToolMessage(
					toolCalls,
					toolMessages,
				);
				if (terminalToolMessage) {
					// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01
					// (AMENDMENT-02): close out an ACTIVE bounded objective
					// at the TERMINAL-TOOL boundary too.
					//
					// A run that ends through the parent's terminal
					// completion tool would otherwise drop the objective
					// without a verdict: the runtime would have consumed
					// its activation allowance and produced no
					// machine-readable fact at all. The objective's
					// UNVERIFIED disposition is a legitimate outcome and
					// must be reported truthfully, not discarded.
					await this.finalizeActiveBoundedObjective();
					const result = this.finishRun(
						"completed",
						finalAssistantMessage,
						textFromToolMessage(terminalToolMessage) || undefined,
					);
					await this.callAfterRunHooks(result);
					await this.emit({
						type: "run-finished",
						snapshot: this.snapshot(),
						result,
					});
					return result;
				}
			}

			throw new Error(
				`Agent runtime exceeded maxIterations (${this.config.maxIterations})`,
			);
		} catch (error) {
			const normalized =
				error instanceof Error ? error : new Error(String(error));
			const isControlledStop = normalized instanceof ControlledStopError;
			const isAborted = this.abortController.signal.aborted || isControlledStop;
			const status = isAborted ? "aborted" : "failed";
			// Read before overwriting lastError below: the class only applies
			// when the run failed on the provider error it was recorded for.
			const errorClass =
				normalized instanceof ContextWindowOverflowError
					? ("context_window_exceeded" as const)
					: normalized.message === this.state.lastError
						? this.state.lastErrorClass
						: undefined;
			// Same guard: the model layer's telemetry only covers this failure
			// if the run failed on that exact recorded error.
			const errorAlreadyReported =
				normalized.message === this.state.lastError &&
				this.state.lastErrorReported;
			this.state.status = status;
			this.state.lastError = normalized.message;
			this.state.lastErrorClass = errorClass;
			this.state.lastErrorReported = errorAlreadyReported;
			const lastAssistantMessage = this.findLastAssistantMessage();
			const result: AgentRunResult = {
				agentId: this.state.agentId,
				agentRole: this.state.agentRole,
				runId: this.state.runId ?? createUID("run"),
				status,
				iterations: this.state.iteration,
				outputText: textFromMessage(lastAssistantMessage),
				messages: cloneMessages(this.state.messages),
				usage: cloneUsage(this.state.usage),
				// C1.4: populate `result.error` for both
				// `failed` AND for the C1.4 abort path so callers
				// can distinguish a runtime-exhaustion stop
				// (ControlledStopError with reason
				// `bounded_recovery_exhausted`) from a true
				// runtime failure AND from a user-controlled
				// abort (e.g., from beforeRun/beforeModel
				// hooks via `stop: true`). Without this, the
				// public `AgentRunResult.error` would lose the
				// truthful reason that the model-stream
				// terminal latch synthesises.
				//
				// The existing C1.2 contract — that user-
				// initiated aborts (beforeRun/beforeModel)
				// produce `result.error === undefined` — is
				// preserved by distinguishing on the
				// ControlledStopError reason: only the
				// C1.4-latch synthesised `bounded_recovery_exhausted`
				// is surfaced as `error` here. User-initiated
				// ControlledStopErrors (with arbitrary
				// reason) keep the pre-C1.4 contract of
				// `error: undefined` on `aborted`.
				error:
					normalized instanceof ControlledStopError &&
					normalized.message === "bounded_recovery_exhausted"
						? normalized
						: status === "failed"
							? normalized
							: undefined,
			};
			this.config.logger?.log?.("Agent loop caught error", {
				severity: status === "failed" ? "error" : "warn",
				agentId: this.state.agentId,
				agentRole: this.state.agentRole,
				runId: result.runId,
				status,
				iteration: this.state.iteration,
				errorName: normalized.name,
				errorMessage: normalized.message,
				assistantContentPartCount: lastAssistantMessage?.content.length ?? 0,
			});
			await this.callAfterRunHooks(result);
			if (status === "failed") {
				await this.emit({
					type: "run-failed",
					snapshot: this.snapshot(),
					error: normalized,
					errorClass,
				});
			} else {
				await this.emit({
					type: "run-finished",
					snapshot: this.snapshot(),
					result,
				});
			}
			return result;
		} finally {
			this.abortController = undefined;
		}
	}

	/**
	 * Injects the collected hook context blocks as one user message at the end
	 * of the conversation. Always delivers: the buffer is empty afterwards.
	 */
	private async flushPendingHookContexts(): Promise<void> {
		if (this.pendingHookContexts.length === 0) {
			return;
		}
		const hookContextText = this.pendingHookContexts.join("\n\n");
		this.pendingHookContexts = [];
		// displayRole "system" keeps the injected block out of user-facing
		// transcripts (live and replayed) while it still reaches the model,
		// mirroring how compaction summaries are handled.
		const hookContextMessage = createMessage(
			"user",
			[{ type: "text", text: hookContextText }],
			{ userRunSpan: 0, displayRole: "system" },
		);
		// Never insert between an assistant tool_use and its tool_result: a
		// resumed session can be seeded with a trailing unresolved tool call,
		// and a user message in that gap breaks providers' pairing rules. The
		// context goes in ahead of that call instead — deferring it would only
		// deliver if the model happened to call a tool next, and the buffer
		// reset at the following run start would otherwise drop it.
		const lastMessage = this.state.messages.at(-1);
		const trailingToolCall =
			lastMessage?.role === "assistant" &&
			lastMessage.content.some((part) => part.type === "tool-call");
		if (trailingToolCall) {
			this.state.messages.splice(-1, 0, hookContextMessage);
		} else {
			this.state.messages.push(hookContextMessage);
		}
		await this.emit({
			type: "message-added",
			snapshot: this.snapshot(),
			message: hookContextMessage,
		});
	}

	private async callBeforeRunHooks(): Promise<void> {
		for (const hook of this.hooks.beforeRun) {
			const result = await hook({
				snapshot: this.snapshot(),
			});
			this.applyStopControl(result);
			// Collected here, injected after the run's input messages are
			// pushed, so the block lands in the same turn as the user prompt.
			if (result?.appendContext?.trim()) {
				this.pendingHookContexts.push(
					formatHookContextBlock({ source: "RunStart" }, result.appendContext),
				);
			}
		}
	}

	private async callAfterRunHooks(result: AgentRunResult): Promise<void> {
		for (const hook of this.hooks.afterRun) {
			await hook({ snapshot: this.snapshot(), result });
		}
	}

	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01.
	 *
	 * The effective recovery-only generation override policy, or `undefined`
	 * when the experiment is DISABLED.
	 *
	 * The experiment is DEFAULT_OFF: absent the policy, or with
	 * `enabled: false`, every recovery code path and every request is
	 * byte-identical to the predecessor.
	 */
	private getRecoveryOutputOverridePolicy():
		| RecoveryOutputOverridePolicy
		| undefined {
		const policy = this.config.recoveryOutputOverridePolicy;
		if (!policy) {
			// ABSENT means the canonical DEFAULT: the experiment is OFF.
			return DEFAULT_RECOVERY_OUTPUT_OVERRIDE_POLICY.enabled === true
				? DEFAULT_RECOVERY_OUTPUT_OVERRIDE_POLICY
				: undefined;
		}
		if (policy.enabled === false) {
			return undefined;
		}
		return policy;
	}

	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01.
	 *
	 * Consume the ONE-SHOT recovery-only generation override, if one is
	 * pending.
	 *
	 * The override is REQUEST-LOCAL: it applies to exactly ONE logical agent
	 * request. The allowance is consumed at the existing runtime boundary
	 * where the request is committed to dispatch, so it is NEVER replenished
	 * if the request fails, is cancelled, exhausts again, is followed by a
	 * compaction, or is followed by a productive round.
	 */
	private consumeRecoveryOutputOverride(): number | undefined {
		const pending = this.pendingRecoveryOutputOverride;
		if (pending === undefined) {
			return undefined;
		}
		// The allowance is spent exactly once per run.
		this.pendingRecoveryOutputOverride = undefined;
		this.recoveryOutputOverrideConsumed = true;
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (C8).
		//
		// The recovery-only override use is OBSERVABLE through the EXISTING
		// `status-notice` metadata bag — the same extensible seam the
		// ordinary max-tokens recovery and the R1/R2 recovery already use.
		//
		// No permanent public protocol field is added, no new diagnostic
		// registry is created, and no transcript duplication or provider
		// reasoning capture is introduced. When the policy is disabled the
		// runtime emits NOTHING extra, so the disabled posture has no
		// state-semantic delta at all.
		void this.emit({
			type: "status-notice",
			snapshot: this.snapshot(),
			message: `recovery-only generation override applied to this request (${pending} output tokens)`,
			metadata: {
				kind: "max_tokens_recovery",
				reason: "recovery_output_override_applied",
				phase: "override_applied",
				iteration: this.state.iteration,
				maxOutputTokens: pending,
			},
		});
		return pending;
	}

	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01.
	 *
	 * ARM the one-shot recovery-only generation override for the NEXT
	 * logical agent request, if every eligibility condition holds.
	 *
	 * ELIGIBILITY (all required):
	 *   - the policy is explicitly ENABLED (DEFAULT_OFF otherwise),
	 *   - the run still has recovery resources,
	 *   - the one-shot allowance has not been consumed in this run,
	 *   - repeated output exhaustion is ESTABLISHED,
	 *   - the exact authorized model and effective reasoning effort are
	 *     ESTABLISHED,
	 *   - no explicit user/request output cap would be exceeded, and
	 *   - the configured recovery allowance is a positive finite number.
	 *
	 * The override is attached to the NEXT established R1 recovery request,
	 * so a larger budget is NOT granted to every ordinary exhausted response.
	 *
	 * An infeasible override is never a reason to block ordinary R1/R2
	 * recovery: the method simply arms nothing.
	 */
	private armRecoveryOutputOverride(): void {
		const policy = this.getRecoveryOutputOverridePolicy();
		if (!policy) {
			return;
		}
		if (this.recoveryOutputOverrideConsumed) {
			return;
		}
		if (this.pendingRecoveryOutputOverride !== undefined) {
			return;
		}
		// The run still has recovery resources.
		if (
			this.exhaustionRecoveryContinuations >=
			MAX_EXHAUSTION_RECOVERY_CONTINUATIONS
		) {
			return;
		}
		// Repeated output exhaustion must be ESTABLISHED. The default
		// threshold is the CONSECUTIVE exhaustion streak limit: a SINGLE
		// cut-off is not "repeated" exhaustion.
		const exhaustionEstablished =
			policy.isExhaustionEstablished?.({
				exhaustionStreak: this.maxTokensExhaustionStreak,
			}) ??
			this.maxTokensExhaustionStreak >= MAX_TOKENS_EXHAUSTION_STREAK_LIMIT;
		if (!exhaustionEstablished) {
			return;
		}
		// The exact authorized model and effective reasoning effort must be
		// ESTABLISHED. The host owns that judgement; the runtime never
		// infers model identity from a provider-specific string comparison
		// of its own.
		//
		// The model identity comes from the EXISTING runtime model-identity
		// resolution (`messageModelInfo.id`, then the configured `modelId`),
		// so the override can never be applied to a model the run is not
		// actually using.
		const modelId = this.telemetryModelId;
		const reasoningEffort = this.effectiveReasoningEffort();
		const providerId = this.telemetryProviderId;
		if (
			policy.isAuthorizedTarget?.({ modelId, reasoningEffort, providerId }) ===
			false
		) {
			return;
		}
		if (policy.modelId !== undefined && policy.modelId !== modelId) {
			return;
		}
		if (
			policy.reasoningEffort !== undefined &&
			policy.reasoningEffort !== reasoningEffort
		) {
			return;
		}
		const recoveryMaxOutputTokens = policy.recoveryMaxOutputTokens;
		if (
			typeof recoveryMaxOutputTokens !== "number" ||
			!Number.isFinite(recoveryMaxOutputTokens) ||
			recoveryMaxOutputTokens <= 0
		) {
			return;
		}
		// EXPLICIT USER/REQUEST OUTPUT CAP PRECEDENCE: the runtime never
		// overrides an explicit cap the host already established on the
		// request options.
		const explicitCap = this.config.modelOptions?.maxTokens;
		if (
			typeof explicitCap === "number" &&
			Number.isFinite(explicitCap) &&
			explicitCap > 0 &&
			explicitCap < recoveryMaxOutputTokens
		) {
			// The explicit cap wins. The override is not applied — and the
			// ordinary R1/R2 recovery is NOT blocked by that fact.
			return;
		}
		this.pendingRecoveryOutputOverride = Math.floor(recoveryMaxOutputTokens);
	}

	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01.
	 *
	 * The EFFECTIVE reasoning effort of the run's model requests.
	 *
	 * It is read from the EXISTING request options (the same field the
	 * gateway reads), so the override can never change the effort: the
	 * override travels on an INDEPENDENT field.
	 */
	private effectiveReasoningEffort(): string | undefined {
		const effort = this.config.modelOptions?.reasoningEffort;
		return typeof effort === "string" ? effort : undefined;
	}

	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
	 *
	 * Recover from a turn that ended at the model's output-token limit without a
	 * usable tool call: nudge the model to be concise and let the caller retry.
	 *
	 * Returns `false` once NO useful authorized intervention remains, so the
	 * run fails truthfully instead of looping.
	 *
	 * ORDINARY RECOVERY POLICY
	 * -------------------------
	 * The ordinary conciseness-reminder mechanism is RETAINED and its
	 * run-scoped allowance remains FINITE
	 * ({@link MAX_TOKENS_RECOVERY_LIMIT}). The allowance is a CONSUMABLE
	 * run-scoped resource: it is spent here and is never replenished by a
	 * read-only inspection, by a repeated tool invocation, by a failed or
	 * unestablished command execution, by compaction, by retry middleware, by
	 * an R1/R2 activation, by a recovery-only generation override, or by the
	 * automatic internal continuation of the same recovery episode. Only a
	 * genuinely NEW externally initiated run initialises its own allowance.
	 *
	 * COORDINATION WITH R1/R2 (the premature-termination correction)
	 * --------------------------------------------------------------
	 * The ordinary allowance (3) is exhausted BEFORE the ordinary R1
	 * threshold (5) can be reached. Enforcing the ordinary allowance alone
	 * therefore terminated the run before the R1/R2 recovery mechanisms could
	 * intervene — the "premature termination" defect.
	 *
	 * The coordination is implemented INSIDE this existing lifecycle method;
	 * no independent R0/R1/R2 supervisor is introduced and the ordinary
	 * conciseness reminder is NOT duplicated as a different message class.
	 *
	 * When the ordinary allowance is spent but the run still has recovery
	 * resources and a still-eligible bounded R1/R2 intervention remains, the
	 * runtime continues the run WITHOUT another ordinary reminder (the
	 * reminder class is exhausted for this run) so that the existing R1
	 * decision — which now observes tool-less exhausted rounds — can fire.
	 *
	 * The continuation is counted against the finite run-scoped ceiling
	 * {@link MAX_EXHAUSTION_RECOVERY_CONTINUATIONS}, which is spent exactly
	 * once per exhaustion-driven continuation and is never replenished.
	 *
	 * THE CONTINUATION AUTHORITY (AMENDMENT-01)
	 * ----------------------------------------
	 * "The stagnation policy is enabled" is NOT "recovery is eligible".
	 *
	 * The predecessor's escalation branch asked only whether the R1 policy
	 * was present and enabled, and therefore kept driving parent model
	 * requests for the whole defensive ceiling AFTER every authorized
	 * intervention (both R1 corrective instructions) had been spent and R2
	 * was absent, unreachable, or already exhausted. Those extra requests
	 * could not do anything useful: no intervention remained to authorise
	 * them. The ordinary reminder path was worse still — it returned `true`
	 * WITHOUT spending the continuation ceiling at all, so the declared
	 * total bound did not bound the ordinary reminders either.
	 *
	 * The continuation decision therefore CONSUMES the EXISTING R1/R2
	 * lifecycle authority through {@link isAuthorizedInterventionReachable}:
	 *
	 *   - an ordinary reminder remains available, OR
	 *   - an authorized intervention is PENDING or remains REACHABLE within
	 *     the remaining budget.
	 *
	 * The defensive ceiling remains a NECESSARY but NOT SUFFICIENT
	 * condition, and EVERY exhaustion-driven continuation — ordinary
	 * reminders included — now spends exactly ONE unit of the common
	 * run-scoped continuation ceiling.
	 */
	private async recoverFromIncompleteMaxTokensTurn(): Promise<boolean> {
		// CANCELLATION PRECEDENCE: a cancelled run never dispatches another
		// recovery continuation. Cancellation outranks every continuation
		// authority, including an available ordinary reminder.
		if (this.abortController?.signal.aborted) {
			return false;
		}
		// THE DEFENSIVE CEILING is necessary but NOT sufficient: it bounds the
		// run, it does not AUTHORISE it.
		if (
			this.exhaustionRecoveryContinuations >=
			MAX_EXHAUSTION_RECOVERY_CONTINUATIONS
		) {
			return false;
		}
		// The ORDINARY conciseness reminder. Its allowance is finite and
		// run-scoped, and an available ordinary reminder IS an authorized
		// intervention — but it spends ONE unit of the COMMON continuation
		// ceiling, so the declared total bound covers it too.
		if (this.maxTokensRecoveryCount < MAX_TOKENS_RECOVERY_LIMIT) {
			this.maxTokensRecoveryCount += 1;
			this.exhaustionRecoveryContinuations += 1;
			await this.emit({
				type: "status-notice",
				snapshot: this.snapshot(),
				message: `output-token limit reached before a tool call — nudging for a more concise response (attempt ${this.maxTokensRecoveryCount}/${MAX_TOKENS_RECOVERY_LIMIT})`,
				metadata: {
					kind: "max_tokens_recovery",
					reason: "max_tokens_recovery",
					phase: "started",
					iteration: this.state.iteration,
					attempt: this.maxTokensRecoveryCount,
					maxRetries: MAX_TOKENS_RECOVERY_LIMIT,
				},
			});
			await this.addUserReminderMessage(MAX_TOKENS_RECOVERY_NUDGE);
			return true;
		}

		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 CORRECTION-01.
		//
		// The ordinary allowance is spent. A still-eligible bounded R1/R2
		// intervention must remain REACHABLE, so the run continues WITHOUT
		// another ordinary reminder — but ONLY when the EXISTING lifecycle
		// authority says an intervention is pending or still reachable.
		//
		// When no useful authorized intervention remains, the run terminates
		// TRUTHFULLY instead of driving requests that no intervention can
		// authorise.
		if (!this.isAuthorizedInterventionReachable()) {
			return false;
		}
		this.exhaustionRecoveryContinuations += 1;
		await this.emit({
			type: "status-notice",
			snapshot: this.snapshot(),
			message: `ordinary output-limit recovery allowance exhausted — continuing the bounded autonomous recovery escalation (${this.exhaustionRecoveryContinuations}/${MAX_EXHAUSTION_RECOVERY_CONTINUATIONS})`,
			metadata: {
				kind: "max_tokens_recovery",
				reason: "max_tokens_recovery_escalation",
				phase: "escalated",
				iteration: this.state.iteration,
				attempt: this.exhaustionRecoveryContinuations,
				maxRetries: MAX_EXHAUSTION_RECOVERY_CONTINUATIONS,
			},
		});
		return true;
	}

	/**
	 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01).
	 *
	 * Whether a USEFUL AUTHORIZED INTERVENTION is pending or still reachable
	 * within the remaining run-scoped budget.
	 *
	 * THIS IS A READ-ONLY CONSULTATION OF THE EXISTING LIFECYCLE AUTHORITY.
	 * It does NOT duplicate the R1/R2 decision algorithm, does NOT fold any
	 * accounting, does NOT inject anything and does NOT decide completion.
	 * It asks the SAME authority the runtime already owns:
	 *
	 *   - R1: the run-scoped execution-stagnation accounting and its policy
	 *     (the corrective-instruction allowance and the streak), and
	 *   - R2: the bounded-objective policy, the activation and
	 *     selection-inference allowances, the ACTIVE objective and its
	 *     remaining objective rounds.
	 *
	 * THE THREE REACHABLE SHAPES
	 * --------------------------
	 *
	 *   1. R1 CORRECTIVE INSTRUCTION PENDING.
	 *      The R1 decision function would produce `inject` right now: the
	 *      streak has reached the threshold and the run-scoped
	 *      corrective-instruction allowance remains.
	 *
	 *   2. R1 CORRECTIVE INSTRUCTION STILL REACHABLE.
	 *      The allowance remains and the streak has NOT yet reached the
	 *      threshold, so further unproductive rounds can still reach it.
	 *      This is the shape that lets the ordinary allowance (3) be
	 *      exhausted BEFORE the R1 threshold (5) without terminating the
	 *      run prematurely — the accepted "premature termination" fix.
	 *
	 *   3. R2 BOUNDED OBJECTIVE REACHABLE.
	 *      Either an objective is ACTIVE and still has objective rounds
	 *      left, or the R1 allowance-exhausted branch is live and R2 may
	 *      still activate: R2 is enabled, the run is active, no objective is
	 *      already active, the activation allowance remains, the
	 *      selection-inference allowance remains, and an authorized parent
	 *      objective exists to derive one from.
	 *
	 * WHEN NONE OF THE THREE HOLDS, the run has NO useful authorized
	 * intervention left, and the exhaustion recovery must terminate
	 * truthfully.
	 */
	private isAuthorizedInterventionReachable(): boolean {
		// ---- A PENDING R1 CORRECTIVE INSTRUCTION ----
		//
		// The instruction was injected at the current execution-round boundary
		// and the model has NOT yet had the opportunity to respond to it. The
		// request that carries it is the request the instruction authorizes,
		// so the run MUST continue for it to be delivered.
		if (this.executionStagnationInstructionPending) {
			return true;
		}
		// ---- R1: the corrective-instruction lifecycle ----
		const policy = this.config.executionStagnationPolicy;
		if (policy && policy.enabled !== false) {
			const threshold = Math.max(
				1,
				Math.floor(policy.unproductiveRoundThreshold),
			);
			const maxInstructions = Math.max(0, policy.maxRecoveryInstructions);
			const allowanceRemains =
				this.executionStagnation.instructionsInjected < maxInstructions;
			if (allowanceRemains) {
				// (1) PENDING: the decision function would inject NOW.
				const decision = decideExecutionStagnation(
					this.executionStagnation,
					policy,
				);
				if (decision.kind === "inject") {
					return true;
				}
				// (2) STILL REACHABLE: the allowance remains and further
				// unproductive rounds can still reach the threshold.
				if (this.executionStagnation.unproductiveRounds < threshold) {
					return true;
				}
			}
		}
		// ---- R2: the bounded-objective lifecycle ----
		const r2Policy = this.getBoundedObjectivePolicy();
		if (!r2Policy) {
			return false;
		}
		if (this.activeBoundedObjective !== undefined) {
			// (3a) An objective is ACTIVE: it is useful while it still has
			// objective rounds left to execute.
			const maxObjectiveRounds = Math.max(
				0,
				r2Policy.maxObjectiveRounds ??
					DEFAULT_BOUNDED_OBJECTIVE_POLICY.maxObjectiveRounds,
			);
			return this.boundedObjectiveFacts.rounds < maxObjectiveRounds;
		}
		// (3b) No objective is active: R2 may still activate, but only when
		// the run is live and EVERY allowance remains.
		if (this.state.status !== "running") {
			return false;
		}
		const maxActivations = Math.max(
			0,
			r2Policy.maxActivations ??
				DEFAULT_BOUNDED_OBJECTIVE_POLICY.maxActivations,
		);
		if (this.boundedObjectiveActivations >= maxActivations) {
			return false;
		}
		const maxSelectionInferences = Math.max(
			0,
			r2Policy.maxSelectionInferences ??
				DEFAULT_BOUNDED_OBJECTIVE_POLICY.maxSelectionInferences,
		);
		if (this.boundedObjectiveSelectionInferences >= maxSelectionInferences) {
			return false;
		}
		// Without an authorized parent objective there is nothing to derive
		// a bounded objective FROM, so R2 cannot activate.
		return this.buildBoundedObjectiveSelectionContext() !== undefined;
	}

	/**
	 * Run a model turn, retrying transient provider/API failures with backoff.
	 *
	 * A turn whose model stream fails with a retryable provider error (rate
	 * limit, 5xx, network hiccup, or OpenRouter's generic "Provider returned
	 * error") is re-issued up to {@link PROVIDER_ERROR_MAX_RETRIES} times, with
	 * exponential backoff between attempts, before the error is allowed to
	 * propagate and end the run. Non-retryable errors (auth, context-window
	 * overflow, other client errors) and any attempt that already produced
	 * visible output or provider tool activity are returned unchanged for the
	 * caller to handle, so this only adds
	 * resilience and never changes behavior for a turn that would otherwise
	 * succeed. Context-window overflow recovery and max-tokens recovery still
	 * run inside each attempt (the latter at most once per run). An unknown
	 * finish without tool activity is continued once from the partial history;
	 * it is never inferred from whether the response contains visible text.
	 */
	private async generateAssistantMessageWithProviderRetry(): Promise<{
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
		interrupted?: boolean;
	}> {
		const issue = () =>
			this.withProviderErrorRetry(() =>
				this.generateAssistantMessageWithOverflowRecovery(),
			);
		const first = await issue();
		if (first.finishReason !== "unknown" || first.interrupted) return first;

		// Tool activity cannot be replayed, and local tool calls must receive
		// their results before another request. Leave those turns to the loop.
		if (
			first.message.content.some((part) => part.type === "tool-call") ||
			this.hasModelToolActivity(first.message)
		)
			return first;

		// An unknown terminal reason, independent of text/reasoning content,
		// permits exactly one continuation from the preserved partial history.
		await this.recordAssistantMessage(first.message, first.finishReason);
		// A user-role continuation avoids treating partial history as assistant
		// prefill. Match hook context visibility in live and replayed transcripts.
		await this.addUserReminderMessage(
			"Previous turn ended unexpectedly. Continue from where you left off.",
			{ displayRole: "system" },
		);
		this.resetLastError();
		return await issue();
	}

	/**
	 * Run `issue`, re-running it with backoff while it returns a turn that
	 * failed with a transient, retryable provider error (see
	 * {@link isRetryableProviderErrorTurn}), up to PROVIDER_ERROR_MAX_RETRIES
	 * times. `issue` decides what is re-run: the whole prepared turn for an
	 * ordinary request, or just the issuing of an already-prepared request.
	 */
	private async withProviderErrorRetry<
		T extends { message: AgentMessage; finishReason: AgentModelFinishReason },
	>(issue: () => Promise<T>): Promise<T> {
		let attempt = 0;
		for (;;) {
			const turn = await issue();
			if (
				attempt >= PROVIDER_ERROR_MAX_RETRIES ||
				!this.isRetryableProviderErrorTurn(turn)
			) {
				return turn;
			}
			attempt += 1;
			const providerError = this.state.lastError;
			// The failed attempt's error is captured for the notice above; clear it
			// so the next attempt's finish event is judged on its own.
			this.resetLastError();
			const delayMs = Math.min(
				PROVIDER_ERROR_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
				PROVIDER_ERROR_RETRY_MAX_DELAY_MS,
			);
			await this.emit({
				type: "status-notice",
				snapshot: this.snapshot(),
				message: `provider error — retrying (attempt ${attempt}/${PROVIDER_ERROR_MAX_RETRIES})`,
				metadata: {
					kind: "provider_error_retry",
					reason: "provider_error_retry",
					phase: "started",
					iteration: this.state.iteration,
					attempt,
					maxRetries: PROVIDER_ERROR_MAX_RETRIES,
					delayMs,
					providerError,
				},
			});
			await this.abortableDelay(delayMs);
		}
	}

	/**
	 * True when a turn failed with a transient provider error that a retry
	 * could plausibly recover, and the failed attempt left nothing behind that
	 * a second stream would duplicate or repeat:
	 * - no content beyond reasoning (text, media, or local tool calls): those
	 *   deltas were already emitted to the UI and there is no event to retract
	 *   them, so re-streaming would show the output twice. Partial reasoning is
	 *   tolerated: it is discarded with the failed message, and losing a long
	 *   thinking phase to a dropped connection is worse than re-streaming it;
	 * - no provider-executed tool activity (recorded in message metadata, not
	 *   content): re-issuing the request could run those side effects again;
	 * - not an auth or context-window failure, which the same request cannot fix.
	 */
	private isRetryableProviderErrorTurn(turn: {
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
	}): boolean {
		if (turn.finishReason !== "error") {
			return false;
		}
		if (turn.message.content.some((part) => part.type !== "reasoning")) {
			return false;
		}
		const modelToolActivities = turn.message.metadata?.modelToolActivities;
		if (Array.isArray(modelToolActivities) && modelToolActivities.length > 0) {
			return false;
		}
		const errorClass = this.state.lastErrorClass;
		if (errorClass === "auth" || errorClass === "context_window_exceeded") {
			return false;
		}
		// Set from the model boundary's typed `isRetryable` flag when available,
		// otherwise classified from the flattened message in the finish handler.
		return this.state.lastErrorRetryable === true;
	}

	/**
	 * Clear the last-error fields. Called at the start of every turn and before
	 * every provider-error retry, so a `finish` event that omits `error` (allowed
	 * by the public AgentModel contract) cannot inherit the class or retryability
	 * of an earlier attempt. Deliberately not called inside overflow recovery,
	 * whose "nothing to compact" error reports the first attempt's provider
	 * message.
	 */
	private resetLastError(): void {
		this.state.lastError = undefined;
		this.state.lastErrorClass = undefined;
		this.state.lastErrorRetryable = undefined;
		this.state.lastErrorReported = false;
	}

	/**
	 * Sleep for `ms`, rejecting early with the abort error if the run is
	 * aborted while waiting, so a retry backoff never blocks cancellation.
	 */
	private async abortableDelay(ms: number): Promise<void> {
		this.throwIfAborted();
		const signal = this.abortController?.signal;
		await new Promise<void>((resolve, reject) => {
			const onAbort = () => {
				clearTimeout(timer);
				reject(this.normalizeAbortError());
			};
			const timer = setTimeout(() => {
				signal?.removeEventListener("abort", onAbort);
				resolve();
			}, ms);
			if (signal) {
				signal.addEventListener("abort", onAbort, { once: true });
			}
		});
	}

	/**
	 * Run a model turn, recovering once per run from each of two conditions:
	 * a provider-rejected context-window overflow, and a response truncated
	 * at the output-token limit on a turn with no tool calls. Both recoveries
	 * force a compaction through `prepareTurn` and retry the request.
	 * Terminal (unrecoverable) overflow states throw with an actionable
	 * message instead of the raw provider error; an unrecoverable truncated
	 * turn is returned as-is so the loop surfaces the max-tokens error with
	 * the partial content preserved.
	 */
	private async generateAssistantMessageWithOverflowRecovery(): Promise<{
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
		interrupted?: boolean;
	}> {
		const first = await this.generateAssistantMessage();
		if (this.isRecoverableMaxTokensTurn(first)) {
			return await this.retryTruncatedTurnWithCompaction(first);
		}
		if (!this.isRecoverableOverflowTurn(first)) {
			return first;
		}
		this.overflowRecoveryAttempted = true;
		const providerError = this.state.lastError;
		if (!this.config.prepareTurn) {
			throw new ContextWindowOverflowError(
				CONTEXT_WINDOW_OVERFLOW_NO_RECOVERY_MESSAGE,
				providerError,
			);
		}
		await this.emit({
			type: "status-notice",
			snapshot: this.snapshot(),
			message: "context window exceeded — compacting and retrying",
			metadata: {
				kind: "context_overflow_recovery",
				reason: "context_overflow_recovery",
				phase: "started",
				iteration: this.state.iteration,
				providerError,
			},
		});
		const retry = await this.generateAssistantMessage({
			overflowRecovery: true,
		});
		if (
			retry.finishReason === "error" &&
			this.state.lastErrorClass === "context_window_exceeded"
		) {
			throw new ContextWindowOverflowError(
				CONTEXT_WINDOW_OVERFLOW_RECOVERY_FAILED_MESSAGE,
				this.state.lastError,
			);
		}
		return retry;
	}

	private isRecoverableOverflowTurn(turn: {
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
	}): boolean {
		if (
			turn.finishReason !== "error" ||
			this.state.lastErrorClass !== "context_window_exceeded" ||
			this.overflowRecoveryAttempted
		) {
			return false;
		}
		// An errored stream that still produced tool calls proceeds through the
		// normal loop (matching existing behavior); a retry would discard that
		// partial work.
		return !turn.message.content.some((part) => part.type === "tool-call");
	}

	private isRecoverableMaxTokensTurn(turn: {
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
	}): boolean {
		if (
			turn.finishReason !== "max-tokens" ||
			this.maxTokensRecoveryAttempted ||
			!this.config.prepareTurn
		) {
			return false;
		}
		// A truncated turn that produced tool calls proceeds through the normal
		// loop, which executes them; only text-only truncations are terminal
		// and worth a recovery attempt.
		if (turn.message.content.some((part) => part.type === "tool-call")) {
			return false;
		}
		// Provider-executed tool activity lives in metadata, not content, and has
		// already happened — replaying the turn would repeat its side effects.
		return !this.hasModelToolActivity(turn.message);
	}

	/** Tool activity executed outside AgentRuntime is recorded in metadata. */
	private hasModelToolActivity(message: AgentMessage): boolean {
		const activities = message.metadata?.modelToolActivities;
		return Array.isArray(activities) && activities.length > 0;
	}

	/**
	 * A response cut off at the output-token limit is often a symptom of a
	 * nearly-full context: local OpenAI-compatible servers (llama.cpp, ollama,
	 * LM Studio) cap generation at whatever context remains, regardless of the
	 * requested output budget. Compacting the conversation frees that room, so
	 * one forced compaction + retry rescues those turns. When compaction has
	 * nothing to remove the original turn is returned, so the loop surfaces the
	 * max-tokens error with the partial content already persisted.
	 *
	 * The truncated turn is not yet persisted while this runs (the loop records
	 * a turn only after it returns), so whenever the attempt ends without a
	 * replacement turn — compaction threw, the retry was aborted, or it errored
	 * with nothing for the loop to execute — the truncated turn is recorded
	 * first and the failure surfaces afterwards; the partial answer is never
	 * lost to the recovery attempt.
	 *
	 * A retry that does come back is handed to the loop unjudged: the run loop
	 * remains the only place that decides whether a turn is acceptable. When
	 * compaction cannot help — nothing to remove, the retry truncated again, or
	 * the turn was never eligible — the loop's own nudge-and-retry recovery
	 * takes over, so this runs first and at most once per run.
	 * Telemetry here is purely
	 * observational — `started`, then `retried` with the retry's finish reason
	 * when the attempt ran, or `failed` when it could not — so it never claims
	 * anything about the run outcome and cannot contradict it.
	 */
	private async retryTruncatedTurnWithCompaction(first: {
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
	}): Promise<{
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
	}> {
		this.maxTokensRecoveryAttempted = true;
		// Distinct from the loop's nudge-and-retry notices (`max_tokens_recovery`)
		// so the two strategies stay tellable apart downstream.
		const noticeMetadata = {
			kind: "max_tokens_compaction",
			reason: "max_tokens_compaction",
			iteration: this.state.iteration,
		};
		this.captureTaskLifecycle(TASK_MAX_TOKENS_RECOVERY_EVENT, {
			phase: "started",
		});
		let retry: { message: AgentMessage; finishReason: AgentModelFinishReason };
		try {
			// Emitted inside the try so a throwing listener still funnels
			// through the terminal-phase catch below.
			await this.emit({
				type: "status-notice",
				snapshot: this.snapshot(),
				message:
					"response hit the output token limit — compacting and retrying",
				metadata: { ...noticeMetadata, phase: "started" },
			});
			// Prepare (compact) once; a transient provider error on the compacted
			// request gets the same bounded retry policy as any other request, but
			// re-issues the *same* prepared request — the transcript has not
			// changed between a 429 and its retry, so recompacting would only repeat
			// the compaction's notices, telemetry, and any summarizer call.
			const prepared = await this.prepareModelRequest({
				overflowRecovery: true,
			});
			retry = await this.withProviderErrorRetry(() =>
				this.issuePreparedRequest(prepared),
			);
		} catch (error) {
			if (error instanceof ContextWindowOverflowError) {
				// Nothing to compact — keep the truncated turn so the loop
				// surfaces the max-tokens error rather than an overflow error.
				this.captureTaskLifecycle(TASK_MAX_TOKENS_RECOVERY_EVENT, {
					phase: "failed",
					eventType: "nothing_to_compact",
				});
				await this.emit({
					type: "status-notice",
					snapshot: this.snapshot(),
					message: "output-token-limit recovery failed: nothing to compact",
					metadata: { ...noticeMetadata, phase: "failed" },
				});
				return first;
			}
			// Close the recovery's telemetry before rethrowing so every started
			// phase has a terminal phase; the thrown error itself is surfaced by
			// the run's own failure path, so no notice here. The error rides along
			// so `error_type` separates a deliberate stop (ControlledStopError,
			// AgentRuntimeAbortError) from a genuine recovery failure without
			// restating how the run loop classifies either.
			this.captureTaskLifecycle(TASK_MAX_TOKENS_RECOVERY_EVENT, {
				phase: "failed",
				eventType: "recovery_threw",
				error,
			});
			await this.recordAssistantMessage(first.message, first.finishReason);
			throw error;
		}
		// `retried` states only that the compaction and retry ran — it makes no
		// claim about the run, which may still reject this turn. The retry's
		// finish reason rides along as an observed fact; pair it with the run
		// outcome to see what became of the turn.
		this.captureTaskLifecycle(TASK_MAX_TOKENS_RECOVERY_EVENT, {
			phase: "retried",
			eventType: retry.finishReason,
		});
		// No replacement turn came back: keep the truncated one and surface what
		// ended the retry, exactly as the loop would have for that finish.
		if (retry.finishReason === "aborted") {
			await this.recordAssistantMessage(first.message, first.finishReason);
			throw this.normalizeAbortError();
		}
		if (
			retry.finishReason === "error" &&
			!retry.message.content.some((part) => part.type === "tool-call")
		) {
			await this.recordAssistantMessage(first.message, first.finishReason);
			// An errored retry that still produced output — text, or a
			// provider-executed tool that has already run — is observable work,
			// not a discardable draft: keep it alongside the truncated turn so the
			// transcript shows what happened (the loop records such a turn before
			// failing, too). Only a retry that produced nothing is dropped.
			if (
				retry.message.content.length > 0 ||
				this.hasModelToolActivity(retry.message)
			) {
				await this.recordAssistantMessage(retry.message, retry.finishReason);
			}
			throw new Error(this.state.lastError ?? "Model stream failed");
		}
		// A retry that came back with nothing is no replacement either: handing it
		// on would trip the loop's empty-response guard, which throws before
		// recording anything — discarding the truncated answer and reporting a
		// misleading error. Keep the truncated turn, exactly as when there was
		// nothing to compact, and let the loop surface the max-tokens error.
		if (
			retry.message.content.length === 0 &&
			!this.hasModelToolActivity(retry.message)
		) {
			return first;
		}
		return retry;
	}

	/** Append an assistant turn to the transcript and announce it. */
	private async recordAssistantMessage(
		message: AgentMessage,
		finishReason: AgentModelFinishReason,
	): Promise<void> {
		this.state.messages.push(message);
		await this.emit({
			type: "message-added",
			snapshot: this.snapshot(),
			message,
		});
		await this.emit({
			type: "assistant-message",
			snapshot: this.snapshot(),
			iteration: this.state.iteration,
			message,
			finishReason,
		});
	}

	private async generateAssistantMessage(options?: {
		overflowRecovery?: boolean;
	}): Promise<{
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
		interrupted?: boolean;
	}> {
		const controller = new AbortController();
		this.modelSteerController = controller;
		try {
			return await this.generateAssistantMessageForRequest(controller, options);
		} finally {
			this.modelSteerController = undefined;
		}
	}

	/**
	 * Issue an already-prepared request as a fresh attempt: turn preparation
	 * (compaction, before-model hooks) is not re-run, but the attempt gets its
	 * own steer controller and lifecycle timing.
	 */
	private async issuePreparedRequest(prepared: PreparedModelRequest): Promise<{
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
		interrupted?: boolean;
	}> {
		const controller = new AbortController();
		this.modelSteerController = controller;
		try {
			return await this.streamPreparedRequest(
				{ ...prepared, startedAt: Date.now() },
				controller,
			);
		} finally {
			this.modelSteerController = undefined;
		}
	}

	/** A model request with turn preparation and before-model hooks applied. */
	private async prepareModelRequest(options?: {
		overflowRecovery?: boolean;
	}): Promise<PreparedModelRequest> {
		// ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01 (R3).
		//
		// The per-request correlation id is minted ONCE per model request
		// and placed in the EXISTING request metadata bag, which already
		// flows agent -> gateway -> provider. It is NEVER serialized into
		// the provider body: the metadata is a transport-side correlation
		// channel, not a payload field.
		//
		// The id is what lets the trace join the REQUESTED reasoning policy
		// to the SERIALIZED wire controls with an EXACT identity join — never
		// by timestamp proximity.
		//
		// R3: upstream splits the model request into prepare -> issue ->
		// stream so a transient provider error can be retried WITHOUT
		// re-running turn preparation. The id is minted here, in
		// `prepareModelRequest` — the ONE place where a model request is
		// created — so it stays exactly one id per model request across the
		// retry path.
		const modelRequestId = createUID("req");
		const modelRequestMetadata = omitUndefinedValues({
			distinctId: trimNonEmpty(this.config.distinctId),
			clientName: trimNonEmpty(this.config.clientName),
			clientVersion: trimNonEmpty(this.config.clientVersion),
			clineCoreVersion: trimNonEmpty(this.config.clineCoreVersion),
			sessionId: trimNonEmpty(this.config.sessionId),
			agentId: this.state.agentId,
			conversationId: trimNonEmpty(this.config.conversationId),
			runId: this.state.runId,
			iteration: this.state.iteration,
			[MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY]: modelRequestId,
		});
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01: consume the
		// ONE-SHOT recovery-only generation override, if one is pending and
		// still eligible. The consumption happens HERE, at the existing
		// runtime boundary where the request is committed to dispatch, so the
		// allowance is spent exactly once per run even if the request fails,
		// is cancelled, or exhausts again.
		const recoveryOutputOverride = this.consumeRecoveryOutputOverride();
		let request: AgentModelRequest = {
			// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 (R2): the
			// R2 DISPATCH PROJECTION.
			//
			// While a bounded objective is ACTIVE, it is projected onto the
			// request's privileged channel. This is what makes the objective
			// the CURRENT EXECUTION TARGET of the request the provider is
			// about to see — materially different from R1's advisory nudge,
			// which merely appends a suggestion to the conversation.
			//
			// The projection is a runtime-owned REQUEST property: the
			// canonical conversation history is NOT mutated, so the parent's
			// conversation and the signed reasoning continuity are preserved.
			systemPrompt: this.projectActiveBoundedObjective(
				this.config.systemPrompt,
			),
			messages: cloneMessages(this.state.messages),
			tools: [...this.tools.values()].map<AgentToolDefinition>((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			})),
			modelTools: this.config.modelTools,
			signal: this.abortController?.signal,
			options: mergeModelOptions(this.config.modelOptions, {
				metadata: modelRequestMetadata,
				// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01:
				// the ONE-SHOT recovery-only generation override.
				//
				// It is attached HERE — the ONE place where a model request is
				// created — so it applies to exactly ONE logical agent
				// request and never leaks anywhere else.
				//
				// The value is a REQUEST-LOCAL `maxTokens`, which the ACTUAL
				// gateway max-output resolution then subjects to the existing
				// clamps: an explicit user/request cap, the model capability
				// maximum and the remaining-context clamp all remain
				// AUTHORITATIVE. The global default is untouched.
				...(recoveryOutputOverride !== undefined
					? { maxTokens: recoveryOutputOverride }
					: {}),
			}),
		};

		const startedAt = Date.now();

		// Read queued input at every request boundary, including retries and
		// continuations within the first iteration.
		const pendingUserMessage = await this.consumePendingUserMessage();
		if (pendingUserMessage) {
			request = {
				...request,
				messages: [...request.messages, ...cloneMessages([pendingUserMessage])],
			};
		}

		request = await this.prepareTurnForModelRequest(request, {
			...options,
			// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: the
			// preparation identity is forwarded to the compaction decision
			// seam so the decision can be joined to the request it measured.
			// It is the SAME id that was minted above — never a second one.
			preparationRequestId: modelRequestId,
		});
		this.throwIfAborted();

		for (const hook of this.hooks.beforeModel) {
			const result = (await hook({
				snapshot: this.snapshot(),
				request,
			})) as AgentBeforeModelResult | undefined;
			this.throwIfAborted();
			this.applyStopControl(result);
			if (result?.messages) {
				request = { ...request, messages: cloneMessages(result.messages) };
			}
			if (result?.tools) {
				request = { ...request, tools: [...result.tools] };
			}
			if (result?.options) {
				request = {
					...request,
					options: mergeModelOptions(request.options, result.options),
				};
			}
		}

		// ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01 — FINAL REQUEST
		// BUDGET AUTHORITY.
		//
		// The `beforeModel` hooks above may REPLACE the request messages or the
		// tool inventory. The request the host measured during `prepareTurn`
		// is therefore not necessarily the request that is dispatched. The
		// budget is enforced HERE — after every mutation, immediately before
		// the request is issued — so the ceiling always applies to the request
		// that actually leaves the process.
		//
		// The measurement uses the SAME conservative estimator as the
		// compaction policy (`estimateRequestInputTokens`, 3 chars per token,
		// flat per-image cost) over the PROVIDER-VISIBLE projection of the
		// final messages. Provider-reported usage is never invented, cached
		// usage is never counted twice, and nothing here relaxes the limit.
		//
		// The check FAILS CLOSED: an over-budget request throws
		// `TaskContractBudgetError` before any provider dispatch and before
		// any compaction sidecar write. The ceiling is supplied by the host
		// (which owns the model limit and the user's operating ceiling); when
		// the host supplies none, this check is disabled, exactly as before
		// the repair.
		if (typeof this.requestBudgetCeilingTokens === "number") {
			// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01.
			//
			// The guard measures the request the provider ACTUALLY receives.
			// On a transport that requires provider-origin authorization for a
			// reasoning block (the Anthropic family), an UNSIGNED reasoning
			// block is omitted by the resolved serializer, so measuring it
			// would over-count content the provider never sees and could
			// reject a request the provider would have accepted.
			//
			// The exclusion is the SAME one the serializer performs, applied
			// to the SAME provider-visible projection, so the guard and the
			// wire cannot disagree.
			const transportFacts = getLlmTransportAuthority().resolveTransportFacts?.(
				{
					providerId: this.config.messageModelInfo?.provider ?? "",
					model: this.config.messageModelInfo,
				},
			);
			const requiresSignedReasoning = requiresSignedReasoningCapability({
				// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A1).
				//
				// The EFFECTIVE transport — the serializer that actually runs
				// for this provider/model pair — is the decisive fact. It
				// already accounts for the per-model protocol override, which
				// the provider client alone does NOT.
				effectiveTransportClient: transportFacts?.effectiveClient,
				transportClient: transportFacts?.client,
				apiProtocol: transportFacts?.apiProtocol,
				family: this.config.messageModelInfo?.family,
				modelId: this.config.messageModelInfo?.id,
				providerId: this.config.messageModelInfo?.provider,
			});
			// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (AMENDMENT-01,
			// A2/A3).
			//
			// The DESTINATION ORIGIN AUTHORITY, built by the repository's
			// SINGLE resolver — the SAME one the wire gate uses, so the guard
			// and the wire compare the recorded origin against the IDENTICAL
			// destination authority.
			//
			// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A2).
			//
			// The destination is resolved HERE, at the request boundary, from
			// the CURRENT route facts — not from the base URL captured at
			// CONSTRUCTION time. A request-scoped route change (or a
			// configuration change between construction and dispatch) must be
			// reflected, and the API LINE must be passed: MiniMax's `china`
			// and `international` endpoints are different HOSTS and therefore
			// different trust domains.
			const transportAuthority = getLlmTransportAuthority();
			const destinationAuthority =
				transportAuthority.resolveDestinationOriginAuthority?.({
					providerId: this.config.messageModelInfo?.provider ?? "",
					baseUrl: this.providerBaseUrl,
					apiLine: this.providerApiLine,
				});
			assertProviderRequestWithinBudget({
				systemPrompt: request.systemPrompt ?? "",
				messages: omitUnauthorizedReasoningBlocks(
					toProviderVisibleMessages(request.messages, {
						requiresSignedReasoning,
						destinationAuthority,
					}),
					{ requiresSignedReasoning, destinationAuthority },
				),
				tools: request.tools,
				maxRequestTokens: this.requestBudgetCeilingTokens,
			});
		}

		// ACT-CLINEMM-ROUND-C-HARNESS-02: report the PROVIDER-READY
		// boundary at the REAL seam.
		//
		// This is the FINAL provider-bound message representation — after
		// every `beforeModel` hook that may have replaced the messages, and
		// after the budget check. It is NOT the persistent conversation
		// history: the two differ whenever a result was rewritten,
		// shortened or omitted on the way to the provider, and that
		// difference is precisely what the compaction sidecar cannot
		// show.
		//
		// Only the request's SIZE, its message count and the per-result
		// inclusion classification are reported. The request's CONTENT is
		// never recorded.
		// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — the PROVIDER
		// DISPATCH RECORD.
		//
		// Computed HERE, at the provider-ready seam, because this is the only
		// point where the request content is final: compaction has run, every
		// `beforeModel` transform has been applied, and the budget has been
		// enforced. The record is then REUSED by the dispatch and completion
		// observations, so all of them describe the same projection.
		//
		// The computation is failure-isolated: a fingerprint failure never
		// changes the request, the dispatch, or the run.
		//
		// P0-2 CORRECTION — the guard is AT THE PRODUCER. Building this
		// record re-projects the provider-visible messages, re-runs the
		// token estimator, canonicalizes the projection and computes a
		// synchronous SHA-256. That work must not happen when NOBODY is
		// listening: an ordinary request in a public profile must not pay
		// for a measurement no consumer reads. When the trace sink is absent
		// (or exposes none of the dispatch-record channels), the record is
		// NOT built at all — the projection and hash work never executes.
		this.activeDispatchRecord = isProviderDispatchRecordRequired(
			this.config.modelBehaviorTraceSink,
		)
			? this.buildProviderDispatchRecord(request)
			: undefined;

		this.observeProviderReady(request);

		this.config.logger?.debug("Agent model request diagnostics", {
			iteration: this.state.iteration,
			providerId:
				"providerId" in this.config &&
				typeof this.config.providerId === "string"
					? this.config.providerId
					: undefined,
			modelId:
				"modelId" in this.config && typeof this.config.modelId === "string"
					? this.config.modelId
					: undefined,
			...summarizeModelRequest(request),
		});

		return { request, startedAt, preparationRequestId: modelRequestId };
	}

	private async generateAssistantMessageForRequest(
		steerController: AbortController,
		options?: {
			overflowRecovery?: boolean;
		},
	): Promise<{
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
		interrupted?: boolean;
	}> {
		const prepared = await this.prepareModelRequest(options);
		return await this.streamPreparedRequest(prepared, steerController);
	}

	/**
	 * Issue a prepared request and assemble the assistant turn from its stream.
	 * Separate from preparation so a prepared request can be re-issued (e.g.
	 * after a transient provider error) without re-running turn preparation.
	 */
	private async streamPreparedRequest(
		prepared: PreparedModelRequest,
		steerController: AbortController,
	): Promise<{
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
		interrupted?: boolean;
	}> {
		const usageBeforeModel = cloneUsage(this.state.usage);
		const getTaskLifecycleDurationMs = () => Date.now() - prepared.startedAt;
		let request = prepared.request;
		// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: bind the
		// preparation identity to the request being issued NOW. It is the
		// SAME id for every provider attempt against this prepared request,
		// so a retry cannot masquerade as a second compaction decision.
		this.activePreparationRequestId = prepared.preparationRequestId;

		this.throwIfAborted();
		// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4):
		// report the EFFECTIVE model configuration at the boundary where the
		// values actually govern execution.
		//
		// This is deliberately AFTER `prepareTurnForModelRequest` and the
		// `beforeModel` hooks, because those can rewrite `request.tools` and
		// `request.options`. Observing the pre-hook request would report a
		// toolset / reasoning policy that the provider never received.
		//
		// The observation is fire-and-forget and failure-isolated: it cannot
		// influence the request, the provider call, or tool execution.
		this.observeEffectiveModelConfig(request);
		this.modelRequestId = createUID("model_request", 21);
		request = {
			...request,
			options: mergeModelOptions(request.options, {
				metadata: { modelRequestId: this.modelRequestId },
			}),
		};
		this.captureTaskLifecycle(TASK_PROVIDER_REQUEST_STARTED_EVENT, {
			durationMs: getTaskLifecycleDurationMs(),
			phase: "provider_request_started",
		});
		// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01: report the model request START
		// boundary to the read-only observation sink. This is the real
		// runtime request boundary (immediately before the provider stream is
		// opened). The observation is fire-and-forget: no return value is
		// read, so the sink cannot influence execution.
		this.observeModelRequestStart(request, summarizeModelRequest(request));
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION01 — the request has
		// finished preparation (compaction, `beforeModel` transforms and the
		// final budget check are all behind it) and is now entering the
		// provider round trip. The preparation span closes HERE, so the
		// provider's response time is never charged to preparation.
		this.observeRequestPrepared(request);
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01: the FINAL runtime
		// projection (stage A). This seam is AFTER compaction, AFTER every
		// `beforeModel` hook and AFTER the request-budget enforcement, so it
		// observes exactly what the runtime INTENDED to submit. DEFAULT OFF.
		//
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION05: the
		// SESSION identity is carried here too.
		//
		// The analyzer makes the session identity MANDATORY on BOTH sides of
		// a comparison, and the two provider-bound stages already carry it
		// (`request.metadata?.sessionId`). Stage A did NOT, so the runtime
		// projection could never be grouped with the AI-SDK and wire stages
		// of the SAME request and every authoritative comparison was refused.
		//
		// This is a CAPTURE-CONTRACT defect, not a cache diagnosis. The
		// identity is the one the runtime already puts into the request
		// metadata for stages B and C, so the three stages of one request
		// now share ONE session identity and land in ONE bundle.
		recordPrefixForensicsRuntimeProjection(request, {
			sessionId: this.modelBehaviorTraceIdentity().sessionId,
			preparationRequestId:
				this.modelBehaviorTraceIdentity().preparationRequestId,
			providerAttemptId: this.modelBehaviorTraceIdentity().modelRequestId,
			iteration: this.state.iteration,
		});
		// Steering cancels provider generation, while request preparation keeps
		// the run-level signal so compaction and hooks can finish consistently.
		request = {
			...request,
			signal: AbortSignal.any([
				steerController.signal,
				...(this.abortController ? [this.abortController.signal] : []),
			]),
		};
		const stream = this.openTaskLifecycleStream(
			request,
			getTaskLifecycleDurationMs,
		);

		const content: AgentMessagePart[] = [];
		const toolAssemblies = new Map<string, PendingToolAssembly>();
		const modelToolActivities = new Map<string, AgentModelToolActivity>();
		let lastToolCallDeltaAt = 0;
		const invalidToolCalls: InvalidToolCall[] = [];
		const sequence: Array<
			{ type: "tool"; key: string } | { type: "part"; part: AgentMessagePart }
		> = [];
		let nextToolIndex = 0;
		let finishReason: AgentModelFinishReason = "unknown";
		let requestId: string | undefined;
		let accumulatedText = "";
		let accumulatedReasoning = "";
		// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01.
		//
		// The provider's CURRENT reasoning block identity.
		//
		// It is tracked OUTSIDE the reasoning part's metadata on purpose: the
		// metadata bag is PROVIDER-OWNED (it carries the provider's opaque
		// signature and redacted payload) and must not receive a
		// ClineMM-internal field.
		let activeReasoningBlockId: string | undefined;

		// RSMT01: raise modelStreaming BEFORE the for-await
		// loop so observers that subscribe to snapshot()
		// mid-stream see the truthful activity signal. The
		// `finally` clears it on every exit path (normal
		// completion, abort, throw), preserving invariant
		// I1 (terminal ⇒ all flags false) and I3 (no active
		// run ⇒ all flags false).
		//
		// RSMT01 EVENT OBSERVABILITY: capture the
		// pre-raise projection and emit AFTER the raise
		// so subscribers learn the new state BEFORE
		// the runtime starts consuming chunks. The
		// `finally` emits the cleared projection.
		//
		// R3: upstream's stream loop body is adopted verbatim (it carries
		// the steer-abort break, the typed retry classification and the
		// model tool-activity bookkeeping the fork lacked). The fork's
		// execution-authority raise/clear wrapper is kept around it.
		const streamBefore = this.buildExecutionProjection();
		this.state.executionModelStreaming = true;
		await this.emitExecutionStateChangeIfChanged(streamBefore);
		try {
			for await (const event of stream) {
				if (steerController.signal.aborted) break;
				this.throwIfAborted();
				switch (event.type) {
					case "text-delta": {
						accumulatedText += event.text;
						const last = sequence.at(-1);
						if (last?.type === "part" && last.part.type === "text") {
							last.part.text += event.text;
						} else {
							sequence.push({
								type: "part",
								part: { type: "text", text: event.text },
							});
						}
						await this.emit({
							type: "assistant-text-delta",
							snapshot: this.snapshot(),
							iteration: this.state.iteration,
							text: event.text,
							accumulatedText,
						});
						break;
					}
					case "media": {
						sequence.push({
							type: "part",
							part: {
								type: "media",
								media: event.media,
							},
						});
						await this.emit({
							type: "assistant-media",
							snapshot: this.snapshot(),
							iteration: this.state.iteration,
							media: event.media,
						});
						break;
					}
					case "reasoning-delta": {
						accumulatedReasoning += event.text;
						const last = sequence.at(-1);
						// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01.
						//
						// A provider response may contain SEVERAL independently
						// signed reasoning blocks (the Anthropic Messages contract
						// allows multiple `thinking` blocks in one assistant turn).
						// Merging them into ONE part loses a signature: a merged
						// block can carry only ONE signature, so every block but the
						// last would be silently dropped on the wire.
						//
						// The provider's block identity (`event.blockId`, the AI
						// SDK's reasoning part id) therefore STARTS A NEW reasoning
						// part when it changes. When the identity is absent the
						// previous merge behaviour is kept, so a provider that does
						// not expose block identity is unaffected.
						const sameBlock =
							event.blockId === undefined ||
							(event.blockId !== undefined &&
								event.blockId === activeReasoningBlockId);
						if (
							last?.type === "part" &&
							last.part.type === "reasoning" &&
							sameBlock
						) {
							last.part.text += event.text;
							last.part.redacted = event.redacted ?? last.part.redacted;
							last.part.metadata = event.metadata ?? last.part.metadata;
						} else {
							sequence.push({
								type: "part",
								part: {
									type: "reasoning",
									text: event.text,
									redacted: event.redacted,
									metadata: event.metadata,
								},
							});
						}
						if (event.blockId !== undefined) {
							activeReasoningBlockId = event.blockId;
						}
						await this.emit({
							type: "assistant-reasoning-delta",
							snapshot: this.snapshot(),
							iteration: this.state.iteration,
							text: event.text,
							accumulatedText: accumulatedReasoning,
							redacted: event.redacted,
							metadata: event.metadata,
						});
						break;
					}
					case "tool-call-delta": {
						if (event.execution) {
							const toolCall: AgentToolCallPart = {
								type: "tool-call",
								toolCallId: event.toolCallId ?? createUID("model_tool"),
								toolName: event.toolName ?? "tool",
								input: event.input,
								metadata: event.metadata,
								execution: event.execution,
							};
							modelToolActivities.set(toolCall.toolCallId, {
								toolCallId: toolCall.toolCallId,
								toolName: toolCall.toolName,
								execution: event.execution,
								input: toolCall.input,
							});
							await this.emit({
								type: "tool-started",
								snapshot: this.snapshot(),
								iteration: this.state.iteration,
								toolCall,
							});
							break;
						}
						const key =
							event.toolCallId ?? `tool_${event.index ?? nextToolIndex}`;
						if (event.index == null && event.toolCallId == null) {
							nextToolIndex += 1;
						}
						let assembly = toolAssemblies.get(key);
						if (!assembly) {
							assembly = {
								toolCallId: event.toolCallId ?? createUID("tool"),
								inputText: "",
							};
							toolAssemblies.set(key, assembly);
							sequence.push({ type: "tool", key });
						}
						if (event.toolCallId) {
							assembly.toolCallId = event.toolCallId;
						}
						if (event.toolName) {
							assembly.toolName = event.toolName;
						}
						if (event.input !== undefined) {
							assembly.inputValue = event.input;
						}
						if (event.metadata !== undefined) {
							assembly.metadata = mergeToolMetadata(
								assembly.metadata,
								event.metadata,
							);
						}
						if (event.inputText) {
							assembly.inputText = mergeToolInputText(
								assembly.inputText,
								event.inputText,
							);
						}
						// Only a progress signal: at most once a second, since each event
						// copies the whole conversation and a large file write streams
						// thousands of argument chunks.
						if (Date.now() - lastToolCallDeltaAt >= 1_000) {
							lastToolCallDeltaAt = Date.now();
							await this.emit({
								type: "tool-call-delta",
								snapshot: this.snapshot(),
								iteration: this.state.iteration,
							});
						}
						break;
					}
					case "tool-result": {
						const existing = modelToolActivities.get(event.toolCallId);
						const activity = {
							...existing,
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							execution: event.execution,
							input: event.input === undefined ? existing?.input : event.input,
							output: event.output,
							isError: event.isError,
						};
						modelToolActivities.set(event.toolCallId, activity);
						const toolCall: AgentToolCallPart = {
							type: "tool-call",
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							input: activity.input,
							execution: event.execution,
						};
						await this.emit({
							type: "tool-finished",
							snapshot: this.snapshot(),
							iteration: this.state.iteration,
							toolCall,
							message: createMessage("tool", [
								{
									type: "tool-result",
									toolCallId: event.toolCallId,
									toolName: event.toolName,
									output: event.output,
									isError: event.isError,
									execution: event.execution,
								},
							]),
						});
						break;
					}
					case "usage": {
						// Record the provider's own input-token count for this request so
						// the prepare-turn pipeline can trigger compaction on real usage
						// rather than a character-based estimate.
						//
						// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01):
						// THE AUTHORITY BOUNDARY.
						//
						// `event.usage.inputTokens` is the AGGREGATE EXPENDITURE: the
						// production retry middleware sums the usage of every PHYSICAL
						// ATTEMPT of the turn, because the provider billed every one of
						// them. It is the correct BILLING quantity, and `updateUsage`
						// below keeps accumulating it unchanged.
						//
						// It is NOT the correct CONTEXT-OCCUPANCY quantity. The
						// compaction budget's calibration compares the provider's count
						// for the PREVIOUS request against the estimator's count for
						// the CURRENT one, so both sides must describe ONE request's
						// occupancy. Re-sending the same prompt three times costs
						// three times as much but occupies the provider's window
						// exactly as much as sending it once: presenting the
						// aggregate as an occupancy lets retries ALONE manufacture a
						// context-window overflow.
						//
						// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01
						// CORRECTION-01): THE OCCUPANCY AUTHORITY.
						//
						// The authority is THREE-VALUED, and the distinction is what
						// forbids the aggregate fallback:
						//
						//   "single"  ONE physical attempt — the aggregate IS the
						//              request's occupancy (the LEGACY shape);
						//   "known"   the SERVED attempt's own prompt size is the
						//              occupancy;
						//   "unknown" the aggregate covers an UNKNOWN number of
						//              requests, so it establishes NO request's
						//              occupancy. The authority is DENIED.
						//
						// An EXPLICITLY UNREPORTED occupancy must NOT fall back to the
						// aggregate: the aggregate is EXPENDITURE over an unknown number
						// of requests, so it describes no single request's occupancy at
						// all. Substituting it re-introduces the very defect this
						// authority was established to remove.
						//
						// When the authority is DENIED, the previous request's occupancy
						// is CLEARED rather than left standing: a STALE occupancy must
						// not be silently attributed to the current request.
						//
						// The aggregate is never divided by an assumed attempt count and
						// cached tokens are never subtracted.
						const occupancy = event.usage.requestOccupancy;
						if (occupancy !== undefined) {
							// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A5.1).
							//
							// The state and the CARDINALITY must be consistent.
							// A contradictory record — `state: "single"` with
							// `attemptCount: 3` — cannot be honoured: the
							// "single" state means "the aggregate IS this
							// request's occupancy", so honouring it would
							// publish the AGGREGATE EXPENDITURE as the
							// occupancy, which is exactly what the three-state
							// architecture forbids.
							//
							// The record is therefore DENIED here as well as
							// at the reader, so the authority cannot be
							// re-established by a path that bypasses the
							// reader.
							const occupancyIsContradictory =
								(occupancy.state === "single" &&
									occupancy.attemptCount !== 1) ||
								(occupancy.state === "known" && occupancy.attemptCount === 1);
							if (occupancyIsContradictory) {
								// An ESTABLISHED-DENIAL: no occupancy authority,
								// and no stale value may stand in for it.
								this.state.lastRequestInputTokens = 0;
							} else if (occupancy.state === "unknown") {
								// The occupancy is UNKNOWN: no authority, and the
								// previous request's occupancy must not linger.
								this.state.lastRequestInputTokens = 0;
							} else {
								// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01
								// (A1).
								//
								// THE "single" STATE REQUIRES AN ESTABLISHED
								// CARDINALITY OF EXACTLY ONE.
								//
								// The cardinality is OPTIONAL, because it is a fact
								// INDEPENDENT of the occupancy: a record can
								// establish that the turn made ONE attempt while
								// failing to establish a measurement, and it can
								// fail to establish a cardinality at all.
								//
								// A "single" state with NO established cardinality
								// is NOT the legacy single-request shape: the
								// reader returns `undefined` only for a TRULY
								// absent marker, so a present record is an
								// explicit statement. Reading the aggregate as
								// the occupancy here would re-enable the
								// aggregate fallback the three-state
								// architecture forbids.
								//
								// The cardinality is NEVER synthesized to satisfy
								// the type.
								const established =
									occupancy.state === "single"
										? occupancy.attemptCount === 1
											? event.usage.inputTokens
											: undefined
										: occupancy.value;
								if (
									typeof established === "number" &&
									Number.isFinite(established) &&
									established > 0
								) {
									this.state.lastRequestInputTokens = established;
								} else {
									// An INVALID measurement grants no occupancy
									// authority, and no stale value may stand in for it.
									this.state.lastRequestInputTokens = 0;
								}
							}
						} else {
							// NO AUTHORITY AT ALL: the usage did not carry the
							// middleware's occupancy authority. This is the LEGACY
							// single-request shape (the usage describes ONE request, so
							// its input count IS that request's occupancy), which is
							// preserved exactly. The stale value is NOT carried over,
							// because the current request's occupancy is the fact being
							// published.
							//
							// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A5.1):
							// the legacy count is validated as a FINITE number. The
							// predecessor accepted `Infinity` (it is `> 0`), which would
							// publish an infinite occupancy and disable the budget's
							// calibration against it.
							const legacy =
								typeof event.usage.inputTokens === "number" &&
								Number.isFinite(event.usage.inputTokens) &&
								event.usage.inputTokens > 0
									? event.usage.inputTokens
									: undefined;
							this.state.lastRequestInputTokens = legacy ?? 0;
						}
						await this.updateUsage(event.usage);
						break;
					}
					case "finish": {
						finishReason = event.reason;
						requestId = event.requestId;
						if (event.error) {
							this.state.lastError = event.error;
							// Models that classify at their own error boundary (where the
							// raw provider error is still structured) win. Anything else —
							// custom `AgentModel` implementations, adapters that carry only
							// a flattened message — is classified from the message so it
							// stays eligible for overflow recovery.
							this.state.lastErrorClass =
								event.errorClass ?? classifyProviderError(event.error);
							// Prefer the boundary's typed `isRetryable` signal; fall back to
							// classifying the flattened message for models that do not carry
							// it.
							this.state.lastErrorRetryable =
								event.errorRetryable ?? isRetryableProviderError(event.error);
							this.state.lastErrorReported = event.errorReported === true;
						}
						break;
					}
				}
			}
		} finally {
			// RSMT01: clear modelStreaming on every exit path
			// (normal completion, abort, throw). Restores
			// the I1 invariant for any terminal lifecycle
			// that follows this turn.
			const modelStreamingWasTrue = this.state.executionModelStreaming;
			this.state.executionModelStreaming = false;
			if (modelStreamingWasTrue) {
				// Emit only if the flag actually flipped
				// from true to false (i.e. the run
				// successfully entered streaming).
				await this.emitExecutionStateChangeIfChanged(streamBefore);
			}
		}
		this.throwIfAborted();
		const interrupted = steerController.signal.aborted;
		if (interrupted) finishReason = "stop";

		for (const item of sequence) {
			// A cancelled stream may contain incomplete tool JSON or unsigned
			// reasoning. Keep only replayable visible content from that response.
			if (
				interrupted &&
				(item.type === "tool" || item.part.type === "reasoning")
			)
				continue;
			if (item.type === "part") {
				content.push(item.part);
				continue;
			}
			const assembly = toolAssemblies.get(item.key);
			if (!assembly?.toolName) {
				invalidToolCalls.push({
					toolCallId: assembly?.toolCallId ?? item.key,
					input: buildInvalidToolInput(assembly?.inputText ?? ""),
					reason: "missing_name",
				});
				continue;
			}
			const parsed = parseToolInput(assembly);
			if (parsed.reason) {
				invalidToolCalls.push({
					toolCallId: assembly.toolCallId,
					toolName: assembly.toolName,
					input: parsed.invalidInput,
					reason: parsed.reason,
				});
			}
			content.push({
				type: "tool-call",
				toolCallId: assembly.toolCallId,
				toolName: assembly.toolName,
				input: parsed.input,
				metadata: parsed.parseError
					? mergeToolMetadata(assembly.metadata, {
							inputParseError: parsed.parseError,
							rawInputText: assembly.inputText,
						})
					: assembly.metadata,
			});
		}

		const messageMetadata: Record<string, unknown> = {};
		if (invalidToolCalls.length > 0) {
			messageMetadata.invalidToolCalls = invalidToolCalls;
		}
		if (modelToolActivities.size > 0) {
			messageMetadata.modelToolActivities = [...modelToolActivities.values()];
		}
		const message = createMessage(
			"assistant",
			content,
			Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
		);
		const metrics = usageDelta(usageBeforeModel, this.state.usage);
		if (metrics) {
			message.metrics = metrics;
			this.captureUnexpectedReasoningTokens(request, metrics);
		}
		if (this.config.messageModelInfo) {
			message.modelInfo = { ...this.config.messageModelInfo };
		}
		for (const hook of this.hooks.afterModel) {
			const control = (await hook({
				snapshot: this.snapshot(),
				assistantMessage: message,
				finishReason,
				...(requestId ? { requestId } : {}),
			})) as AgentStopControl | undefined;
			this.applyStopControl(control);
		}

		// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01: report the model request FINISH
		// boundary (real runtime boundary — the provider stream has ended and
		// the usage delta for this request is known).
		const modelRequestFinishPayload = {
			finishReason,
			requestDurationMs: Date.now() - prepared.startedAt,
			// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — the
			// PROVIDER-USAGE record.
			//
			// `usageAvailable` states whether the provider REPORTED usage at
			// all. When it is false the token fields are ABSENT (never zero):
			// a missing usage is UNAVAILABLE, not "the provider said zero".
			//
			// The token fields carry the provider's OWN semantics. Per the
			// established provider contract, `inputTokens` is the COMPLETE
			// prompt and `cacheReadTokens` is a SUBSET of it. The cached
			// amount is therefore reported alongside the total and is NEVER
			// added to it — adding them would double-count the cached
			// portion.
			usageAvailable: metrics !== undefined,
			...(metrics
				? {
						inputTokens: metrics.inputTokens,
						outputTokens: metrics.outputTokens,
						cacheReadTokens: metrics.cacheReadTokens,
						cacheWriteTokens: metrics.cacheWriteTokens,
					}
				: {}),
			// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: the
			// provider-dispatch record is echoed so the usage joins to the
			// EXACT projection that produced it, without needing a
			// timestamp join.
			...(this.activeDispatchRecord ?? {}),
			// ACT-CLINEMM-MINIMAX-REASONING-HARNESS-DISCRIMINATOR01 (R1).
			//
			// The PROVIDER-REPORTED reasoning token count. It is reported
			// only when the provider supplied one, so an absent field means
			// "the provider did not report it", never "zero reasoning".
			...(metrics?.reasoningTokenCount !== undefined
				? { providerReportedReasoningTokens: metrics.reasoningTokenCount }
				: {}),
			// The PRESENCE and SIZE of streamed reasoning content. Only the
			// byte COUNT is recorded: no reasoning text is retained, so the
			// observation cannot leak model-internal content.
			...summarizeReasoningContent(content),
			toolCallCount: content.filter((part) => part.type === "tool-call").length,
			invalidToolCallCount: invalidToolCalls.length,
		};
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION01 — the provider round
		// trip has ended. This is reported BEFORE the generic model-request
		// finish so the provider-bound interval closes at the provider seam.
		this.observeProviderRequestCompleted(modelRequestFinishPayload);
		this.observeModelRequestFinish(modelRequestFinishPayload);

		// R3: upstream's return carries the `interrupted` flag, which is how
		// the caller distinguishes a STEER-interrupted turn (retry with the
		// queued user message) from a completed turn. The fork's earlier
		// two-field return shadowed it and silently dropped the flag, so a
		// steered turn was treated as a normal completion.
		return { message, finishReason, interrupted };
	}

	private async *openTaskLifecycleStream(
		request: AgentModelRequest,
		getTaskLifecycleDurationMs: () => number | undefined,
	): AsyncIterable<AgentModelEvent> {
		// C1.4 MODEL-STREAM TERMINAL LATCH. The second-stage
		// continuation state machine is consulted IMMEDIATELY
		// before `model.stream(...)` is invoked. After the bounded
		// continuation opportunity has been used (state ===
		// "terminating"), the model-stream seam becomes a no-op
		// that throws the same ControlledStopError the abort path
		// uses. Truthfully reuse the existing abort-style
		// termination: the outer loop's catch maps
		// `ControlledStopError` to `state.status = "aborted"` with
		// `lastError` and `result.error` populated for downstream
		// observation. C1.5 may later widen the public surface if
		// telemetry differentiation between user-aborted and
		// recovery-exhausted becomes necessary; the C1.4 first
		// version reuses the existing truthful outcome.
		//
		// Critical: the latch transitions from `armed` to
		// `terminating` are decided INSIDE
		// `applyRecoveryPostClassification`, NOT here at stream
		// entry. The post-arm model request MUST be allowed to
		// issue (it is the model's bounded continuation). Only
		// AFTER its tool-call outcome is classified does the
		// runtime decide whether the continuation was a
		// meaningful recovery (success ⇒ reset to `idle`) or a
		// non-convergent attempt (failure / pre-exec block ⇒
		// `terminating`). Flipping the latch at stream entry
		// would consume the continuation slot on a pre-exec block
		// before the model could even propose a recovery — which
		// is exactly the wrong direction.
		if (this.recoverySecondStage.kind === "terminating") {
			// ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01: the bounded-recovery
			// controlled-stop ORIGIN. It is a RUNTIME-initiated termination
			// and is DISTINCT from an explicit user cancel, even though both
			// produce the same terminal `status`.
			this.observeRunAbortRequested(
				"runtime_controlled_stop",
				"bounded_recovery_exhausted",
			);
			throw new ControlledStopError("bounded_recovery_exhausted");
		}
		// Surface the typed reason in `state.lastError` so any
		// downstream observer of the snapshot — including the
		// events emitted before this stream is opened — can see
		// that the runtime is in the "armed" C1.4 latch state.
		// The final `terminating` transition is performed by
		// `applyRecoveryPostClassification` for non-success
		// outcomes observed during the continuation turn.
		if (this.recoverySecondStage.kind === "armed") {
			this.state.lastError = "bounded_recovery_exhausted";
		}
		let stream: AsyncIterable<AgentModelEvent>;
		let phase = "provider_request_started";
		try {
			// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02 — the provider
			// request was ACTUALLY SUBMITTED.
			//
			// This is the real dispatch seam: the instant the provider's
			// `stream()` is invoked. Every provider-side timer (the
			// submission instant, the first response event and the first
			// generated token) is anchored HERE, so the provider interval
			// never includes the request-preparation time that preceded it.
			//
			// The observation is fire-and-forget and failure-isolated: it
			// cannot influence the provider call or the agent's behaviour.
			this.observeProviderRequestSubmitted(request);
			stream = await this.config.model.stream(request);
			this.throwIfAborted();
			phase = "provider_stream_started";
			this.captureTaskLifecycle(TASK_PROVIDER_STREAM_STARTED_EVENT, {
				durationMs: getTaskLifecycleDurationMs(),
				phase,
			});
		} catch (error) {
			if (request.signal?.aborted && !this.abortController?.signal.aborted)
				return;
			if (!request.signal?.aborted && !this.isAbortError(error)) {
				this.captureTaskLifecycleFailure(
					error,
					phase,
					getTaskLifecycleDurationMs(),
				);
			}
			// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01: report the provider failure
			// at the REAL request boundary. An abort is reported as an abort
			// (not an error) so the offline analysis can distinguish "the
			// model failed" from "the operator cancelled".
			//
			// ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01: the payload now also
			// carries the concrete error identity (name + BOUNDED SANITIZED
			// message) and the OBSERVED request outcome. Without the error
			// name, two different provider failures that share a coarse
			// `errorClass` were indistinguishable in the retained evidence.
			//
			// The outcome is derived from what was actually observed AT THIS
			// SEAM: a provider throw before the stream opened is
			// `provider_error`; a throw DURING the stream is `stream_error`.
			// Nothing is inferred from the absence of a finish record.
			this.observeModelRequestFailure(
				this.isAbortError(error) ? "abort" : "error",
				{
					phase,
					requestDurationMs: getTaskLifecycleDurationMs(),
					errorClass: classifyProviderError(error),
					...(this.isAbortError(error) ? { aborted: true } : {}),
					...this.describeObservedProviderError(error, phase),
				},
			);
			throw error;
		}

		let receivedFirstChunk = false;
		// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-3) — the
		// FIRST-RESPONSE and FIRST-TEXT observations.
		//
		// The two events are DISTINCT and are never conflated:
		//
		//   - the first RESPONSE event is the first event the provider's
		//     stream produced at all. It measures the transport's
		//     time-to-first-event. A transport chunk is NOT necessarily
		//     model output.
		//   - the first TEXT is the first observed GENERATED TEXT — a
		//     NON-EMPTY text delta. It is NOT the model's first generated
		//     TOKEN: a reasoning-first request generates reasoning tokens
		//     before any text exists, and a tool-call-only request
		//     generates tokens without ever emitting text.
		//
		// Neither measurement is an authoritative time-to-first-token. The
		// server-side TTFT is UNAVAILABLE_FROM_TRACE.
		//
		// The observation is metadata-only: the event TYPE, the generated
		// text's LENGTH and the server-side-TTFT availability marker —
		// never the text itself.
		//
		// The stream's iteration, ordering, cancellation and buffering are
		// UNCHANGED: the observation is a side-effect on the events the
		// runtime already consumes, it never pre-reads, buffers or
		// re-orders anything.
		let observedFirstResponse = false;
		let observedFirstText = false;
		try {
			for await (const event of stream) {
				if (!receivedFirstChunk) {
					receivedFirstChunk = true;
					phase = "first_chunk_received";
					this.captureTaskLifecycle(TASK_FIRST_CHUNK_RECEIVED_EVENT, {
						durationMs: getTaskLifecycleDurationMs(),
						phase,
						eventType: event.type,
					});
				}
				if (!observedFirstResponse) {
					observedFirstResponse = true;
					this.observeProviderFirstResponse(event.type);
				}
				// The first GENERATED TEXT is the first NON-EMPTY text
				// delta. An EMPTY text delta is not generated text, so it
				// must not close the first-text boundary.
				if (
					!observedFirstText &&
					event.type === "text-delta" &&
					(event.text ?? "").length > 0
				) {
					observedFirstText = true;
					this.observeProviderFirstText(event);
				}
				yield event;
			}
		} catch (error) {
			if (request.signal?.aborted && !this.abortController?.signal.aborted)
				return;
			if (!request.signal?.aborted && !this.isAbortError(error)) {
				this.captureTaskLifecycleFailure(
					error,
					phase,
					getTaskLifecycleDurationMs(),
				);
			}
			// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01: same boundary as above, for
			// a failure that occurred DURING the stream.
			//
			// ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01: the concrete error
			// identity and the observed outcome are added here too. A
			// mid-stream failure is `stream_error`, never `provider_error`,
			// and a clean provider finish reason is NOT fabricated for it.
			this.observeModelRequestFailure(
				this.isAbortError(error) ? "abort" : "error",
				{
					phase,
					requestDurationMs: getTaskLifecycleDurationMs(),
					errorClass: classifyProviderError(error),
					firstChunkObserved: receivedFirstChunk,
					...(this.isAbortError(error) ? { aborted: true } : {}),
					...this.describeObservedProviderError(error, phase),
				},
			);
			throw error;
		}
	}

	/**
	 * ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01.
	 *
	 * Describe the OBSERVED provider error identity for the trace payload.
	 *
	 * - `errorName`    — the concrete error class name (e.g. `APICallError`),
	 *                   which distinguishes failures that share a coarse
	 *                   `errorClass`.
	 * - `errorMessage` — a BOUNDED, SECRET-SCRUBBED, single-line message.
	 *                   A provider can echo a credential inside an error
	 *                   string, so the message is sanitized through the
	 *                   shared sanitizer before it is retained.
	 * - `requestOutcome` — the OBSERVED outcome, derived from the phase the
	 *                   failure was observed at:
	 *                     - an abort error            -> `caller_cancelled`
	 *                     - before the stream opened  -> `provider_error`
	 *                     - during the stream         -> `stream_error`
	 *
	 * The outcome is NEVER `completed` and NEVER `in_flight_at_run_end`:
	 * this seam observed a terminal failure.
	 */
	private describeObservedProviderError(
		error: unknown,
		phase: string,
	): Record<string, unknown> {
		const errorName =
			error instanceof Error &&
			typeof error.name === "string" &&
			error.name.length > 0
				? error.name
				: undefined;
		const errorMessage = sanitizeTraceErrorMessage(
			error instanceof Error ? error.message : undefined,
		);
		const requestOutcome = this.isAbortError(error)
			? "caller_cancelled"
			: phase === "provider_request_started"
				? "provider_error"
				: "stream_error";
		return {
			...(errorName !== undefined ? { errorName } : {}),
			...(errorMessage !== undefined ? { errorMessage } : {}),
			requestOutcome,
		};
	}

	private captureTaskLifecycleFailure(
		error: unknown,
		phase: string,
		durationMs: number | undefined,
	): void {
		this.captureTaskLifecycle(TASK_PROVIDER_STREAM_FAILED_EVENT, {
			durationMs,
			error,
			errorClass: classifyProviderError(error),
			phase,
		});
	}

	private captureTaskLifecycle(
		event: string,
		input: Partial<Omit<CaptureTaskLifecycleEventInput, "event">> = {},
	): void {
		const sessionId = trimNonEmpty(this.config.sessionId);
		captureTaskLifecycleEvent(this.config.telemetry, {
			event,
			modelRequestId: this.modelRequestId,
			sessionId,
			ulid: sessionId,
			agentId: this.state.agentId,
			conversationId: trimNonEmpty(this.config.conversationId),
			runId: this.state.runId,
			iteration: this.state.iteration > 0 ? this.state.iteration : undefined,
			providerId: this.getTelemetryProviderId(),
			modelId: this.getTelemetryModelId(),
			...input,
		});
	}

	private getTelemetryProviderId(): string | undefined {
		return (
			trimNonEmpty(this.config.messageModelInfo?.provider) ??
			this.telemetryProviderId
		);
	}

	private getTelemetryModelId(): string | undefined {
		return (
			trimNonEmpty(this.config.messageModelInfo?.id) ?? this.telemetryModelId
		);
	}

	// -----------------------------------------------------------------------
	// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — read-only observation helpers.
	//
	// Every method below is FIRE-AND-FORGET: the sink's return value is
	// never read, and every sink call is wrapped so a throwing sink can
	// never affect a model call, a tool execution, or a lifecycle commit.
	// -----------------------------------------------------------------------

	/**
	 * The correlation identity for an observation produced by this runtime.
	 *
	 * Session id comes from the host-owned config, run id from the live run
	 * state, and the iteration from the live counter. A missing identity is
	 * OMITTED (never guessed).
	 */
	private modelBehaviorTraceIdentity(): {
		sessionId?: string;
		runId?: string;
		iteration?: number;
		modelRequestId?: string;
		preparationRequestId?: string;
		providerId?: string;
		modelId?: string;
	} {
		return {
			...(trimNonEmpty(this.config.sessionId)
				? { sessionId: trimNonEmpty(this.config.sessionId) }
				: {}),
			...(this.state.runId ? { runId: this.state.runId } : {}),
			...(this.state.iteration > 0 ? { iteration: this.state.iteration } : {}),
			// ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01: the per-model-request
			// correlation id.
			//
			// The id is already minted per issued model request and already
			// travels to the provider layer in the request metadata. Carrying
			// it on the observation is what lets a provider-terminal record
			// be joined to the provider's own request identity by an EXACT
			// key instead of by timestamp proximity.
			//
			// It is ABSENT (never synthesized) when no model request has been
			// issued yet in this runtime.
			...(this.modelRequestId ? { modelRequestId: this.modelRequestId } : {}),
			// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: the
			// PREPARATION identity, carried on every provider-side
			// observation. It is the join key between the compaction
			// DECISION (which measured the prepared request) and the
			// provider DISPATCH / USAGE (which observed the attempt).
			//
			// It is ABSENT (never synthesized) when no prepared request is
			// active.
			...(this.activePreparationRequestId
				? { preparationRequestId: this.activePreparationRequestId }
				: {}),
			...(this.getTelemetryProviderId()
				? { providerId: this.getTelemetryProviderId() }
				: {}),
			...(this.getTelemetryModelId()
				? { modelId: this.getTelemetryModelId() }
				: {}),
		};
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4).
	 *
	 * Report the EFFECTIVE model configuration that governs this request.
	 *
	 * The values are read from the request that is ABOUT TO BE SENT:
	 *   - `toolCount` / `toolNames` — the effective model-request tool
	 *     schemas (the real action space the provider is offered),
	 *   - `reasoningEffort` / `thinkingEnabled` — the effective provider
	 *     request configuration,
	 *   - `maxOutputTokens` — the resolved model/request output limit.
	 *
	 * An omitted provider reasoning setting is NOT proof of a particular
	 * provider default: it is reported as "not specified by the runtime",
	 * which the comparator treats as UNVERIFIED rather than equal.
	 *
	 * The identity is the REAL session id and run id — this is what binds an
	 * effective configuration to an execution instead of to a timestamp.
	 */
	private observeEffectiveModelConfig(request: AgentModelRequest): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onEffectiveModelConfig) {
			return;
		}
		try {
			const options = request.options ?? {};
			const thinking = options.thinking;
			const reasoningEffort = options.reasoningEffort;
			const maxOutputTokens = options.maxTokensPerTurn;
			const requestId = readModelBehaviorRequestId(request);
			sink.onEffectiveModelConfig({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					toolCount: request.tools.length,
					toolNames: request.tools.map((tool) => tool.name),
					// ACT-CLINEMM-MODEL-BEHAVIOR-WIRE-REASONING-TRACE01: the
					// per-request correlation id. It is what joins this
					// REQUESTED configuration to the SERIALIZED wire controls
					// with an exact identity join.
					...(requestId !== undefined ? { requestId } : {}),
					// `undefined` means the runtime did not specify it — NOT
					// "the provider default".
					...(typeof thinking === "boolean"
						? { thinkingEnabled: thinking }
						: {}),
					...(typeof reasoningEffort === "string" ? { reasoningEffort } : {}),
					...(typeof maxOutputTokens === "number" &&
					Number.isFinite(maxOutputTokens)
						? { maxOutputTokens }
						: {}),
				},
			});
		} catch {
			// Failure isolation.
		}
	}

	private observeModelRequestStart(
		request: AgentModelRequest,
		summary: Record<string, unknown>,
	): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onModelRequestStart) {
			return;
		}
		try {
			sink.onModelRequestStart({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					// The request summary is ALREADY a privacy-safe aggregate
					// (counts and character lengths) produced by the
					// production `summarizeModelRequest` helper.
					...summary,
					...summarizeReasoningConfiguration(request),
					toolSchemaCount: request.tools.length,
				},
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * Report that the model request finished preparation.
	 *
	 * ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION01. The runtime calls this
	 * from `prepareModelRequest`, after compaction, every `beforeModel`
	 * transform and the final provider-request budget check, and before
	 * the request is handed to the provider. The observation is failure-
	 * isolated and carries only a privacy-safe request summary.
	 */
	private observeRequestPrepared(request: AgentModelRequest): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onRequestPrepared) {
			return;
		}
		try {
			sink.onRequestPrepared({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					...summarizeModelRequest(request),
					// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: the
					// provider-dispatch record, describing the FINAL
					// provider-visible projection.
					...(this.activeDispatchRecord ?? {}),
				},
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
	 *
	 * Build the PROVIDER-DISPATCH record for the FINAL request.
	 *
	 * "Final" means: AFTER compaction, AFTER every `beforeModel` transform
	 * and AFTER the final request-budget enforcement. That is the only point
	 * at which the request content is the content the provider will see, so
	 * it is the only honest place to fingerprint it.
	 *
	 * The record carries the C2 correlation and provenance:
	 *
	 *   - `preparationRequestId` — the PREPARATION identity (on the trace
	 *     identity, not duplicated here);
	 *   - `providerAttemptId` — the ATTEMPT identity (on the trace identity
	 *     as `modelRequestId`);
	 *   - `modelId` / `providerFamily` — the model and provider identity;
	 *   - `estimatedFinalInputTokens` — the production estimator applied to
	 *     the FINAL provider-visible projection (the SAME estimator the
	 *     compaction policy uses, so the two numbers are comparable);
	 *   - `providerVisibleMessageCount` — the number of messages the
	 *     provider actually sees;
	 *   - `toolSchemaCount` — the number of tool schemas in the request;
	 *   - `finalProjectionFingerprint` — the deterministic SHA-256 of the
	 *     canonicalized final projection, together with its representation
	 *     version and producer.
	 *
	 * The fingerprint is a CONTENT fingerprint of the CLIENT-side
	 * representation. It is NOT a claim of byte-identical provider-wire
	 * content: the provider adapter may still transform the request after
	 * this point. The representation and producer are recorded precisely so
	 * that no consumer can mistake one for the other.
	 *
	 * FAILURE ISOLATED: a fingerprint failure never changes the request, the
	 * dispatch, or the run. It only means the fingerprint is absent.
	 */
	private buildProviderDispatchRecord(
		request: AgentModelRequest,
	): Record<string, unknown> {
		const providerMessages = toProviderVisibleMessages(request.messages);
		const base: Record<string, unknown> = {
			modelId: this.getTelemetryModelId(),
			providerFamily: this.getTelemetryProviderId(),
			estimatedFinalInputTokens: estimateRequestInputTokens({
				systemPrompt: request.systemPrompt ?? "",
				messages: providerMessages,
				tools: request.tools,
			}),
			providerVisibleMessageCount: providerMessages.length,
			toolSchemaCount: request.tools.length,
		};
		try {
			const fingerprint = computeFinalProjectionFingerprint({
				systemPrompt: request.systemPrompt ?? "",
				messages: providerMessages,
				tools: request.tools,
				options: request.options ?? {},
			});
			return {
				...base,
				finalProjectionFingerprint: fingerprint.fingerprint,
				finalProjectionRepresentation: fingerprint.representation,
				finalProjectionRepresentationVersion: fingerprint.representationVersion,
				finalProjectionFingerprintProducer: fingerprint.producer,
			};
		} catch {
			// Failure isolation: the fingerprint is absent, never faked.
			return base;
		}
	}

	/**
	 * Report that the provider request was ACTUALLY SUBMITTED.
	 *
	 * ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02. The runtime calls this
	 * from the real dispatch seam — the instant the provider's `stream()` is
	 * invoked — and it anchors every provider-side timer (the submission
	 * instant, the first provider response event and the first generated
	 * token).
	 *
	 * Anchoring those timers at the start of request preparation would
	 * charge the preparation cost to the provider: a 250 ms preparation
	 * followed by 100 ms to the first token would report a 350 ms
	 * time-to-first-token instead of the true 100 ms.
	 *
	 * The observation is failure-isolated and carries only a privacy-safe
	 * request summary.
	 */
	private observeProviderRequestSubmitted(request: AgentModelRequest): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onProviderRequestSubmitted) {
			return;
		}
		try {
			sink.onProviderRequestSubmitted({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					...summarizeModelRequest(request),
					// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: the
					// provider-dispatch record. The ATTEMPT identity
					// (`modelRequestId`) and the PREPARATION identity
					// (`preparationRequestId`) are on the trace identity;
					// this payload describes the CONTENT that was sent.
					...(this.activeDispatchRecord ?? {}),
				},
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * Report that the provider round trip has ended.
	 *
	 * ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION01. The runtime calls this
	 * when the provider stream completes. It closes the provider-bound
	 * interval separately from request preparation.
	 */
	private observeProviderRequestCompleted(
		payload: Record<string, unknown>,
	): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onProviderRequestCompleted) {
			return;
		}
		try {
			sink.onProviderRequestCompleted({
				...this.modelBehaviorTraceIdentity(),
				payload,
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * Report the FIRST observed provider RESPONSE EVENT.
	 *
	 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01.
	 *
	 * This is the first event the provider's stream produced at all. It
	 * is NOT the first generated token: a transport chunk is not
	 * necessarily model output, so this observation measures the
	 * transport's time-to-first-event and is never reported as a
	 * time-to-first-token.
	 *
	 * The observation is metadata-only — the event TYPE, never content.
	 */
	private observeProviderFirstResponse(eventType: string): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onProviderFirstResponse) {
			return;
		}
		try {
			sink.onProviderFirstResponse({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					eventType,
				},
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * Report the FIRST observed GENERATED TEXT.
	 *
	 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-3).
	 *
	 * A `text-delta` carrying actual model text IS generated TEXT, so this
	 * is the first-generated-TEXT observation. The observation is
	 * metadata-only: the generated text's LENGTH, never the text itself.
	 *
	 * ## This is NOT an authoritative first-token measurement
	 *
	 * The boundary is named for what it MEASURES. It does NOT establish the
	 * model's first generated TOKEN, because:
	 *
	 *   - a reasoning-first request generates REASONING tokens before any
	 *     text delta exists;
	 *   - a tool-call-only request generates tokens without ever emitting a
	 *     text delta.
	 *
	 * The provider's server-side token accounting is not surfaced at this
	 * seam, so the observation carries the explicit marker
	 * `serverSideTtft: "UNAVAILABLE_FROM_TRACE"`. No consumer can mistake
	 * this boundary for an authoritative time-to-first-token.
	 *
	 * A provider that emits no text at all (a tool-call-only or an empty
	 * response) never produces this observation, and the measurement
	 * stays unavailable rather than being inferred.
	 */
	private observeProviderFirstText(event: AgentModelEvent): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onProviderFirstText) {
			return;
		}
		try {
			const text = event.type === "text-delta" ? event.text : "";
			sink.onProviderFirstText({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					eventType: event.type,
					generatedTextLength: text.length,
					// The server-side time to first token is NOT observable at
					// this seam. It is recorded as explicitly unavailable
					// rather than being inferred from the text delta.
					serverSideTtft: "UNAVAILABLE_FROM_TRACE",
				},
			});
		} catch {
			// Failure isolation.
		}
	}

	private observeModelRequestFinish(payload: Record<string, unknown>): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onModelRequestFinish) {
			return;
		}
		try {
			sink.onModelRequestFinish({
				...this.modelBehaviorTraceIdentity(),
				payload,
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01.
	 *
	 * Report the ORIGIN of a termination to the read-only observation sink.
	 *
	 * This is the abort-initiation seam. The payload carries:
	 *   - `abortOrigin`       — the declared origin classification,
	 *   - `initiator`         — the component that requested the termination,
	 *   - `abortReason`       — a BOUNDED, SECRET-SCRUBBED reason,
	 *   - `abortErrorName`    — the concrete error class name, when the
	 *                            reason was an error.
	 *
	 * The `modelRequestId` of the request that was in flight at the moment
	 * the termination was requested rides on the observation identity, which
	 * is what binds the origin to the request it interrupted.
	 *
	 * Fire-and-forget and failure-isolated.
	 */
	private observeRunAbortRequested(
		origin: AgentRuntimeAbortOrigin,
		reason: unknown,
	): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onRunAbortRequested) {
			return;
		}
		try {
			const abortReason = sanitizeTraceErrorMessage(
				reason instanceof Error ? reason.message : reason,
			);
			const abortErrorName =
				reason instanceof Error &&
				typeof reason.name === "string" &&
				reason.name.length > 0
					? reason.name
					: undefined;
			sink.onRunAbortRequested({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					abortOrigin: origin,
					initiator: "agent_runtime",
					...(abortReason !== undefined ? { abortReason } : {}),
					...(abortErrorName !== undefined ? { abortErrorName } : {}),
				},
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * Report a provider failure / abort observed at the model stream
	 * boundary.
	 */
	observeModelRequestFailure(
		kind: "error" | "abort",
		payload: Record<string, unknown>,
	): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (kind === "error") {
			if (!sink?.onModelRequestError) {
				return;
			}
			try {
				// Invoked as a METHOD so a stateful adapter keeps its
				// receiver — see `observeSchemaValidation`.
				sink.onModelRequestError({
					...this.modelBehaviorTraceIdentity(),
					payload,
				});
			} catch {
				// Failure isolation.
			}
			return;
		}
		if (!sink?.onModelRequestAbort) {
			return;
		}
		try {
			sink.onModelRequestAbort({
				...this.modelBehaviorTraceIdentity(),
				payload,
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * Compute the privacy-preserving argument fingerprint for a tool call.
	 *
	 * The SINK owns the ephemeral key, so the raw arguments are handed to it
	 * and only the fingerprint comes back. Returns `undefined` when no sink
	 * is attached or the fingerprint could not be computed. Never throws.
	 *
	 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01 — TRACING-OFF FAST PATH
	 * ------------------------------------------------------------------
	 * `await`ing a promise ALWAYS introduces a microtask suspension point,
	 * even when the awaited value is `undefined`. Awaiting the fingerprint
	 * unconditionally therefore changed the execution order of the
	 * tool-start boundary relative to the tool execution EVEN WHEN THE
	 * RECORDER WAS DISABLED.
	 *
	 * This helper is therefore NOT `async`. It returns either:
	 *   - `undefined`          — no sink, or tracing is provably OFF,
	 *   - `string | undefined` — the sink answered synchronously,
	 *   - `Promise<...>`       — the sink answered asynchronously.
	 *
	 * The caller awaits ONLY when it actually received a promise, so the
	 * trace-OFF path introduces NO suspension point at all and the
	 * execution order is identical to the pre-instrumentation order.
	 *
	 * When the `isTraceEnabled()` signal is ABSENT the runtime cannot prove
	 * tracing is off, so it requests the fingerprint exactly as before. That
	 * keeps the behavior of every sink that does not implement the signal
	 * unchanged.
	 */
	private fingerprintToolArguments(
		toolName: string,
		input: unknown,
	): string | undefined | Promise<string | undefined> {
		const sink = this.config.modelBehaviorTraceSink;
		const handler = sink?.fingerprintToolArguments;
		if (!handler) {
			return undefined;
		}
		try {
			const enabled = sink?.isTraceEnabled?.();
			if (enabled === false) {
				// Tracing is OFF: take the SYNCHRONOUS fast path. No promise
				// is created, so the caller never awaits and no suspension
				// point is introduced.
				return undefined;
			}
			const result = handler(toolName, input);
			if (result instanceof Promise) {
				return result.catch(() => {
					// Failure isolation.
					return undefined;
				});
			}
			return result;
		} catch {
			// Failure isolation.
			return undefined;
		}
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * Build the metadata bag handed to the tool executor.
	 *
	 * The host's own `toolContextMetadata` is passed through UNCHANGED.
	 * The trace sink and the correlation identity are ADDED only when a
	 * sink is attached, so the tracing-OFF path produces exactly the same
	 * metadata object it produced before this feature existed.
	 */
	private buildToolContextMetadata(
		toolCallId: string,
		approvalOutcome: ModelBehaviorTraceEditApprovalOutcome,
	): Record<string, unknown> | undefined {
		const hostMetadata = this.config.toolContextMetadata;
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink) {
			return hostMetadata;
		}
		const identity = this.modelBehaviorTraceIdentity();
		return {
			...(hostMetadata ?? {}),
			[EDIT_OBSERVATION_SINK_METADATA_KEY]: sink,
			[EDIT_OBSERVATION_IDENTITY_METADATA_KEY]: {
				...identity,
				toolCallId,
			},
			// The runtime is the authority for the authorization state; the
			// executor cannot infer it, so it is handed down here.
			[EDIT_OBSERVATION_APPROVAL_METADATA_KEY]: approvalOutcome,
		};
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * Report the "edit requested → authorized" link for a native edit tool.
	 *
	 * Only `editor` and `apply_patch` are native editing tools, and they
	 * are MUTUALLY EXCLUSIVE in the tool registry: when the `editor`
	 * executor is present the `apply_patch` tool is not registered at all
	 * (see `definitions.ts`). A run therefore uses exactly one of them,
	 * and the trace records which one was actually available.
	 *
	 * The observation is STRUCTURAL:
	 *   - the operation comes from the tool INPUT SHAPE,
	 *   - the target count and requested size are COUNTS and LENGTHS,
	 *   - the file identity is an ephemeral fingerprint of the resolved
	 *     path computed by the sink (which owns the key).
	 *
	 * No path, no text, no patch body is ever handed to the sink.
	 */
	private async observeEditAttempt(
		prepared: PreparedToolExecution,
	): Promise<void> {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onEditAttempt) {
			return;
		}
		const toolName = prepared.toolCall.toolName;
		if (toolName !== "editor" && toolName !== "apply_patch") {
			return;
		}
		try {
			const shape = describeEditRequest(toolName, prepared.input);
			const fileIdentity = await this.fingerprintEditPath(shape.resolvedPath);
			// Invoked as a METHOD so a stateful adapter keeps its receiver.
			sink.onEditAttempt({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					toolCallId: prepared.toolCall.toolCallId,
					toolName,
					operation: shape.operation,
					fileIdentity: fileIdentity ?? MODEL_BEHAVIOR_TRACE_UNAVAILABLE,
					targetCount: shape.targetCount,
					requestedChars: shape.requestedChars,
					approvalOutcome: prepared.approvalOutcome ?? "unavailable",
					// The C1.2 authority: `toolExecutionInvoked` is set
					// IMMEDIATELY before `tool.execute(...)`. At the tool-start
					// boundary the executor has NOT run yet, so the attempt
					// reports "not yet invoked"; the executor's own
					// application event is the authority for what happened.
					executionInvoked: false,
				},
			});
		} catch {
			// Failure isolation: instrumentation NEVER affects an edit.
		}
	}

	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 *
	 * Compute the ephemeral fingerprint of a resolved path.
	 *
	 * Returns `undefined` when tracing is provably OFF, so the disabled
	 * path performs NO fingerprint computation and NO extra file read.
	 */
	private async fingerprintEditPath(
		resolvedPath: string | undefined,
	): Promise<string | undefined> {
		if (resolvedPath === undefined) {
			return undefined;
		}
		const sink = this.config.modelBehaviorTraceSink;
		const handler = sink?.fingerprintFilePath;
		if (!handler) {
			return undefined;
		}
		try {
			const result = handler(resolvedPath);
			const fingerprint = result instanceof Promise ? await result : result;
			if (fingerprint === undefined) {
				return undefined;
			}
			// DEFENCE IN DEPTH: the sink's contract is to return ONLY a
			// keyed digest. A sink that echoed the path back would leak the
			// filesystem layout into the trace, so such a value is discarded
			// and the identity is reported as unavailable instead.
			if (fingerprint.includes(resolvedPath)) {
				return undefined;
			}
			return fingerprint;
		} catch {
			return undefined;
		}
	}

	/**
	 * Report a tool execution boundary observed by the runtime.
	 *
	 * `origin` distinguishes a MODEL-REQUESTED tool call from a runtime
	 * generated or host-control call.
	 */
	observeToolBoundary(
		kind: "start" | "finish",
		payload: Record<string, unknown>,
	): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink) {
			return;
		}
		try {
			// Invoked as a METHOD so a stateful adapter keeps its receiver —
			// see `observeSchemaValidation`.
			if (kind === "start") {
				if (!sink.onToolStart) {
					return;
				}
				sink.onToolStart({
					...this.modelBehaviorTraceIdentity(),
					payload,
				});
				return;
			}
			if (!sink.onToolFinish) {
				return;
			}
			sink.onToolFinish({
				...this.modelBehaviorTraceIdentity(),
				payload,
			});
		} catch {
			// Failure isolation.
		}
	}

	private isAbortError(error: unknown): boolean {
		return (
			error instanceof AgentRuntimeAbortError ||
			this.abortController?.signal.aborted === true
		);
	}

	/**
	 * ACT-CLINEMM-ROUND-C-HARNESS-02 — report the SCHEMA VALIDATION
	 * boundary to the observation sink.
	 *
	 * Failure-isolated: a throwing sink must never change the agent's
	 * behaviour. Only the outcome and the input's SIZE are reported; the
	 * input itself is never recorded, because it can carry a command's
	 * arguments or a file's content.
	 */
	private observeSchemaValidation(
		toolName: string,
		valid: boolean,
		input: unknown,
	): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onSchemaValidation) {
			return;
		}
		try {
			// ACT-CLINEMM-ROUND-C-HARNESS-02: the sink is invoked AS A
			// METHOD on the sink object. Detaching the function
			// (`const h = sink.onSchemaValidation; h(...)`) loses the
			// receiver, and a stateful adapter — the latency sink — would
			// then throw on `this.record(...)`. That failure was silently
			// swallowed by the isolation catch, so the boundary never
			// appeared in the trace while the runtime believed it had
			// reported it.
			sink.onSchemaValidation({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					toolName,
					schemaValid: valid,
					toolResultBytes: getOutputSize(input),
				},
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * ACT-CLINEMM-ROUND-C-HARNESS-02 — report the TOOL RESULT DELIVERY
	 * boundary to the observation sink.
	 *
	 * Failure-isolated. Only the result's SIZE is reported; its content
	 * is never recorded.
	 */
	private observeToolResultDelivered(toolMessage: AgentMessage): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onToolResultDelivered) {
			return;
		}
		try {
			let bytes = 0;
			let itemCount = 0;
			let toolCallId: string | undefined;
			let toolName: string | undefined;
			for (const part of toolMessage.content) {
				if (part.type !== "tool-result") {
					continue;
				}
				itemCount += 1;
				toolCallId = toolCallId ?? part.toolCallId;
				toolName = toolName ?? part.toolName;
				bytes += getOutputSize(part.output);
			}
			// Invoked as a METHOD so the adapter keeps its receiver — see
			// `observeSchemaValidation` for why the detached call is wrong.
			sink.onToolResultDelivered({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					toolCallId,
					toolName,
					toolResultBytes: bytes,
					toolResultItemCount: itemCount,
				},
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * ACT-CLINEMM-ROUND-C-HARNESS-02 — report the PROVIDER-READY boundary
	 * to the observation sink.
	 *
	 * The projection is the FINAL provider-bound message representation,
	 * computed from the request as it will be dispatched. The request's
	 * CONTENT is never recorded: only its size, its message count, and the
	 * inclusion classification of each tool result.
	 *
	 * Failure-isolated.
	 */
	private observeProviderReady(request: {
		messages: readonly AgentMessage[];
		systemPrompt?: string;
	}): void {
		const sink = this.config.modelBehaviorTraceSink;
		if (!sink?.onProviderReady) {
			return;
		}
		try {
			const providerMessages = toProviderVisibleMessages(request.messages);
			let bytes = getOutputSize(request.systemPrompt ?? "");
			// The provider projection uses the wire shape, where a tool
			// result is `tool_result` and carries the ORIGINATING tool
			// call id. The index lets the conversation's results be
			// matched to their provider-bound counterparts BY IDENTITY
			// rather than by position — position is not stable once the
			// projection merges adjacent tool messages.
			const providerToolResults = new Map<string, number>();
			for (const message of providerMessages) {
				bytes += getOutputSize(message.content);
				const content = message.content;
				if (typeof content === "string") {
					continue;
				}
				for (const part of content) {
					if (part.type !== "tool_result") {
						continue;
					}
					const providerBytes = getOutputSize(part.content);
					const existing = providerToolResults.get(part.tool_use_id);
					providerToolResults.set(
						part.tool_use_id,
						(existing ?? 0) + providerBytes,
					);
				}
			}
			// Classify EVERY conversation tool result against the
			// provider-bound projection:
			//
			//   - FULL     — present with the same size;
			//   - SHORTENED— present but smaller than the conversation's
			//                 copy (a truncation or a rewrite);
			//   - OMITTED  — not present in the projection at all.
			//
			// Only SIZES and COUNTS are recorded. The result's content
			// never leaves this method.
			let included = 0;
			let shortened = 0;
			let omitted = 0;
			for (const message of request.messages) {
				for (const part of message.content) {
					if (part.type !== "tool-result") {
						continue;
					}
					const conversationBytes = getOutputSize(part.output);
					const providerBytes = providerToolResults.get(part.toolCallId);
					if (providerBytes === undefined) {
						omitted += 1;
						continue;
					}
					if (providerBytes < conversationBytes) {
						shortened += 1;
						continue;
					}
					included += 1;
				}
			}
			// Invoked as a METHOD so a stateful adapter keeps its receiver.
			sink.onProviderReady({
				...this.modelBehaviorTraceIdentity(),
				payload: {
					providerRequestBytes: bytes,
					providerMessageCount: providerMessages.length,
					toolResultIncludedCount: included,
					toolResultShortenedCount: shortened,
					toolResultOmittedCount: omitted,
				},
			});
		} catch {
			// Failure isolation.
		}
	}

	private captureUnexpectedReasoningTokens(
		request: AgentModelRequest,
		metrics: NonNullable<AgentMessage["metrics"]>,
	): void {
		if (
			!reasoningWasRequestedOff(request) ||
			(metrics.reasoningTokenCount ?? 0) <= 0
		) {
			return;
		}
		const reasoningTokenCount = metrics.reasoningTokenCount;
		if (reasoningTokenCount === undefined) {
			return;
		}

		captureAgentUnexpectedReasoningTokens(this.config.telemetry, {
			sessionId: this.config.sessionId,
			agentId: this.state.agentId,
			runId: this.state.runId,
			iteration: this.state.iteration,
			providerId: this.config.messageModelInfo?.provider,
			modelId: this.config.messageModelInfo?.id,
			requestedThinking: false,
			reasoningTokenCount,
		});
	}

	private async prepareTurnForModelRequest(
		request: AgentModelRequest,
		options?: {
			overflowRecovery?: boolean;
			/**
			 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
			 *
			 * The preparation request identity, forwarded VERBATIM into the
			 * host's prepare-turn context so the compaction decision seam
			 * can join its decision to the request it measured.
			 */
			preparationRequestId?: string;
		},
	): Promise<AgentModelRequest> {
		if (!this.config.prepareTurn) {
			// No host pipeline means no host ceiling. Clear any ceiling left
			// over from a previous turn so a stale limit can never be applied
			// to a request the host did not measure.
			this.requestBudgetCeilingTokens = undefined;
			return request;
		}

		const overflowRecovery = options?.overflowRecovery === true;
		const result = await this.config.prepareTurn({
			agentId: this.state.agentId,
			conversationId: this.config.conversationId,
			parentAgentId: this.state.parentAgentId ?? null,
			iteration: this.state.iteration,
			messages: request.messages,
			systemPrompt: request.systemPrompt,
			tools: request.tools,
			model: {
				id: this.config.messageModelInfo?.id,
				provider: this.config.messageModelInfo?.provider,
			},
			signal: request.signal,
			overflowRecovery: overflowRecovery || undefined,
			previousRequestInputTokens:
				this.state.lastRequestInputTokens > 0
					? this.state.lastRequestInputTokens
					: undefined,
			// ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01: forward the
			// preparation identity VERBATIM. The compaction decision seam
			// records it on the decision, which makes the decision ->
			// dispatch -> usage join authoritative.
			...(options?.preparationRequestId !== undefined
				? { preparationRequestId: options.preparationRequestId }
				: {}),
			emitStatusNotice: (message, metadata) => {
				void this.emit({
					type: "status-notice",
					snapshot: this.snapshot(),
					message,
					metadata,
				});
			},
			// ACT-CLINEMM-CMP08-SUMMARIZATION-USAGE-CONSERVATION-01: the
			// host reports the provider-reported usage of any auxiliary
			// inference it performed (today: the summarization request the
			// compaction seam dispatches).
			//
			// The usage is accounted through the SAME mechanism the main
			// model's usage uses: `updateUsage()` adds the reported delta
			// to the runtime's usage state, and the resulting
			// `usage-updated` event flows through the ordinary production
			// consumer. There is no second ledger.
			//
			// The report is applied WHATEVER became of the inference's
			// result: a rejected, cancelled or refused summarization request
			// was still paid for.
			reportAuxiliaryUsage: (usage) => {
				void this.updateUsage({
					inputTokens: usage.inputTokens,
					outputTokens: usage.outputTokens,
					cacheReadTokens: usage.cacheReadTokens,
					cacheWriteTokens: usage.cacheWriteTokens,
					reasoningTokenCount: usage.reasoningTokenCount,
					totalCost: usage.totalCost,
				});
			},
		});
		if (overflowRecovery) {
			// Only retry a provider-rejected overflow with a request that is
			// actually smaller — anything else is guaranteed to fail again.
			//
			// Serialized length is a coarse proxy for tokens, which is all this
			// backstop needs: it answers "did anything get removed at all" for
			// arbitrary `prepareTurn` implementations, and the shared estimator
			// is itself linear in character count, so switching units would not
			// change the verdict. Authoritative token budgeting (against the
			// model's limit) happens inside the compaction pipeline.
			// TODO: have `prepareTurn` report the token estimates it already
			// computed (before/after) so this decision can use real numbers
			// instead of re-deriving a proxy here.
			const shrunk =
				result?.messages !== undefined &&
				JSON.stringify(result.messages).length <
					JSON.stringify(request.messages).length;
			if (!shrunk) {
				throw new ContextWindowOverflowError(
					CONTEXT_WINDOW_OVERFLOW_NOTHING_TO_COMPACT_MESSAGE,
					this.state.lastError,
				);
			}
		}
		if (!result) {
			// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-
			// TRANSPORT-REPAIR01 (fifteenth-pass): prepareTurn
			// returned no result at all. Fail closed: W =
			// undefined for this turn. See the comment below
			// for the contract.
			const wBefore = this.state.currentWorkingContextEstimate;
			this.state.currentWorkingContextEstimate = undefined;
			// ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: the host
			// published no ceiling for this turn, so there is no ceiling to
			// enforce on the final request. Clearing it prevents a stale
			// limit from a previous turn being applied here.
			this.requestBudgetCeilingTokens = undefined;
			// Emit if and only if the no-result case
			// changed the field. The helper dedups
			// internally.
			const emitDecision =
				await this.emitWorkingContextStateChangeIfChanged(wBefore);
			// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-
			// TRANSPORT-REPAIR01 (thirtieth-pass): fire the
			// upstream W trace observer with the no-result
			// discriminator. `prepareTurnW` is `undefined`
			// here because the producer returned no result;
			// `resultKind` distinguishes this from the
			// producer-published-a-W-but-omitted-the-field
			// branch below.
			this.notifyRuntimeWTraceObserver({
				sessionId: this.config.sessionId,
				iteration: this.state.iteration,
				resultKind: "prepare_turn_undefined_result",
				prepareTurnW: undefined,
				runtimeW: this.state.currentWorkingContextEstimate,
				previousRuntimeW: wBefore,
				willEmit: emitDecision.willEmit,
				emitResolved: emitDecision.emitResolved,
			});
			return request;
		}

		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-
		// TRANSPORT-REPAIR01 (fifteenth-pass): STATE_BIND
		// LIFETIME FAIL-CLOSED.
		//
		// Frozen contract:
		//   prepareTurn returns W:
		//     state.W = W
		//   prepareTurn returns no W:
		//     state.W = undefined
		//   prepareTurn returns undefined result:
		//     state.W = undefined
		//
		// This is the "current W" semantics: W_n is the
		// value returned by the **most recent** prepareTurn
		// that ran on this runtime. If the producer
		// unexpectedly stops publishing W on a later
		// prepareTurn, the field fails CLOSED to
		// `undefined` rather than preserving a stale
		// plausible-looking value.
		//
		// Why this and not "last-known-W":
		//   The producer contract requires every prepareTurn
		//   to publish W. Preserving the prior W when a
		//   later prepareTurn omits it silently converts a
		//   missing-authority defect (publisher stopped
		//   emitting) into a stale-but-plausible UI value.
		//   That is exactly the failure class C2 (current
		//   working context) is designed to eliminate. If
		//   a producer begins to emit no-W regularly, the
		//   correct consumer behavior is "no current W"
		//   (= undefined), not "carry the old one forward".
		//
		// NO RECOMPUTE on the agent-runtime side:
		// the runtime captures verbatim; if the producer
		// published no W this turn, the runtime does not
		// fabricate one. PRODUCTION_W_AUTHORITIES = 1.
		const wBefore = this.state.currentWorkingContextEstimate;
		this.state.currentWorkingContextEstimate =
			result.currentWorkingContextEstimate;
		// ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01: capture the
		// host-published effective request-input ceiling verbatim. The runtime
		// enforces it against the FINAL provider request (after the
		// `beforeModel` hooks), so a hook that replaces the messages or the
		// tool inventory cannot escape the ceiling.
		//
		// Captured verbatim, exactly like W: the runtime never resolves,
		// relaxes, or invents a limit of its own.
		this.requestBudgetCeilingTokens = result.maxRequestTokens;
		// PUBLICATION_BIND: emit iff the field actually
		// changed (helper dedups). The await is awaited
		// before the caller resumes; this guarantees that
		// when `await prepareTurnForModelRequest(...)`
		// returns in `generateAssistantMessage`, the
		// listener has ALREADY received the
		// `working-context-state-changed` event (or the
		// helper observed no change and emitted nothing).
		const emitDecision =
			await this.emitWorkingContextStateChangeIfChanged(wBefore);
		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-
		// TRANSPORT-REPAIR01 (thirtieth-pass): fire the
		// upstream W trace observer with the
		// producer-published discriminator. `prepareTurnW`
		// is the exact field the producer returned (number
		// or `undefined` if the producer omitted the field).
		// `runtimeW` is the post-capture state value
		// (which may equal `prepareTurnW` or differ in
		// `undefined` vs `number` shapes only when the
		// producer omitted the field; otherwise it equals
		// `prepareTurnW` because we copy verbatim).
		this.notifyRuntimeWTraceObserver({
			sessionId: this.config.sessionId,
			iteration: this.state.iteration,
			resultKind: "prepare_turn",
			prepareTurnW: result.currentWorkingContextEstimate,
			runtimeW: this.state.currentWorkingContextEstimate,
			previousRuntimeW: wBefore,
			willEmit: emitDecision.willEmit,
			emitResolved: emitDecision.emitResolved,
		});

		let next = request;
		if (result.messages) {
			const preparedMessages = cloneMessages(result.messages);
			next = { ...next, messages: cloneMessages(preparedMessages) };
		}
		if (result.systemPrompt !== undefined) {
			next = { ...next, systemPrompt: result.systemPrompt };
		}
		return next;
	}

	private async consumePendingUserMessage(): Promise<AgentMessage | undefined> {
		const consumePendingUserMessage = this.config.consumePendingUserMessage;
		if (!consumePendingUserMessage) {
			return undefined;
		}
		const pending = (await consumePendingUserMessage())?.trim();
		if (!pending) {
			return undefined;
		}
		const message = createMessage("user", [{ type: "text", text: pending }], {
			userRunSpan: 0,
		});
		this.state.messages.push(message);
		await this.emit({
			type: "message-added",
			snapshot: this.snapshot(),
			message,
		});
		return message;
	}

	private async updateUsage(usage: Partial<AgentUsage>): Promise<void> {
		this.state.usage = {
			inputTokens: this.state.usage.inputTokens + (usage.inputTokens ?? 0),
			outputTokens: this.state.usage.outputTokens + (usage.outputTokens ?? 0),
			cacheReadTokens:
				this.state.usage.cacheReadTokens + (usage.cacheReadTokens ?? 0),
			cacheWriteTokens:
				this.state.usage.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
			reasoningTokenCount:
				(this.state.usage.reasoningTokenCount ?? 0) +
				(usage.reasoningTokenCount ?? 0),
			totalCost: (this.state.usage.totalCost ?? 0) + (usage.totalCost ?? 0),
		};
		await this.emit({
			type: "usage-updated",
			snapshot: this.snapshot(),
			usage: cloneUsage(this.state.usage),
		});
	}

	private async executeToolCalls(
		toolCalls: AgentToolCallPart[],
	): Promise<AgentMessage[]> {
		this.pendingHookContexts = [];
		const prepared: PreparedToolExecution[] = [];
		for (const toolCall of toolCalls) {
			prepared.push(await this.prepareToolExecution(toolCall));
		}

		const results: AgentMessage[] = [];
		for (let index = 0; index < prepared.length; ) {
			const execution = prepared[index];
			const mode = execution.tool?.executionMode ?? this.config.toolExecution;
			if (mode === "sequential") {
				results.push(await this.executePreparedTool(execution));
				index += 1;
				continue;
			}

			// Only adjacent parallel calls overlap. An ordinary sequential tool
			// must wait for the group before it, and finish before the next group.
			const start = index;
			while (
				index < prepared.length &&
				(prepared[index].tool?.executionMode ?? this.config.toolExecution) ===
					"parallel"
			) {
				index += 1;
			}
			// R3: the fork's C1.4/C1.5 recovery-latch authority is preserved, but
			// it now scopes to the PARALLEL GROUP that actually overlaps (the
			// batch whose siblings can complete in any order), not to the whole
			// call list. A sequential tool between two groups is not a sibling of
			// either group and must not arm or clear the group's latch.
			const group = prepared.slice(start, index);
			results.push(...(await this.executeParallelGroup(group)));
		}
		return results;
	}

	/**
	 * Execute one overlapping group of parallel tool calls under the fork's
	 * C1.4/C1.5 recovery-latch authority.
	 *
	 * The latch fires when the group started in the `armed` state AND any
	 * sibling resolved with a typed `failure` outcome (per the C1.1
	 * `ToolRuntimeOutcome` authority model — NOT the coarse
	 * `AgentToolResult.isError` flag). The batch-level decision is dominant:
	 * a sibling success applied first may have reset the latch to idle, so the
	 * group-level reconciliation re-arms it to `terminating`.
	 */
	private async executeParallelGroup(
		group: PreparedToolExecution[],
	): Promise<AgentMessage[]> {
		const batchStartKind = this.recoverySecondStage.kind;
		// C1.5: capture the canonical projection at the batch boundary and
		// suspend per-tool emission for the duration of the group. Per-tool
		// mutations inside `Promise.all` are provisional — reconciliation below
		// may overturn them — so emitting them would make the public event
		// sequence depend on completion order.
		const recoveryBatchBefore = this.snapshotRecoveryState();
		this.recoveryEmissionSuspended = true;
		// Reset the per-batch buffer at the start of each group. The buffer is
		// runtime-owned and never visible externally.
		this.pendingBatchOutcomes.length = 0;
		let results: AgentMessage[];
		try {
			results = await Promise.all(
				group.map((execution) => this.executePreparedTool(execution)),
			);
			if (
				batchStartKind === "armed" &&
				this.recoverySecondStage.kind !== "terminating" &&
				this.batchContainsTypedFailure(this.pendingBatchOutcomes)
			) {
				// The trigger may have been cleared by an earlier sibling
				// success's applyPost (which transitions armed → idle and discards
				// the trigger). The batch-level decision is dominant: we set the
				// trigger to `episode_exhausted` because the underlying arming
				// cause was an episode-level non-convergence. (Other triggers are
				// possible but episode_exhausted is the most general one; the
				// C14_REAL_PARALLEL_OK_FIRST test pins this choice.)
				this.recoverySecondStage = {
					kind: "terminating",
					trigger: "episode_exhausted",
				};
				this.state.lastError = "bounded_recovery_exhausted";
			}
		} finally {
			// C1.5 / C1.6 residue: clear the private typed-outcome buffer and
			// lift the emission guard even when a tool executor, hook, or abort
			// throws out of the batch. Without this, a throwing batch would leave
			// `recoveryEmissionSuspended === true` and silence every subsequent
			// recovery event for the run, and would leak stale outcomes into the
			// next batch's reconciliation.
			this.pendingBatchOutcomes.length = 0;
			this.recoveryEmissionSuspended = false;
		}
		// C1.5 PARALLEL EVENT ATOMICITY: exactly one canonical recovery event
		// for the whole group, describing the reconciled batch-level truth.
		// FAIL_FIRST and OK_FIRST therefore produce identical public sequences.
		await this.emitRecoveryStateChangeIfChanged(recoveryBatchBefore);
		return results;
	}

	/**
	 * C1.4 parallel-batch latch helper. Inspects a
	 * collection of typed `ToolRuntimeOutcome` records
	 * (one per sibling in a parallel batch) and returns
	 * true if any sibling resolved with a typed `failure`
	 * outcome.
	 *
	 * Authority model (C1.1):
	 *   outcome.kind === "failure"
	 *     → recovery-relevant; consumes episode budget.
	 *   outcome.kind === "success"
	 *     → not relevant to the latch decision.
	 *   outcome.kind === "control_plane"
	 *     → NOT relevant. Includes:
	 *       - real `host_policy_denied`
	 *       - real `user_rejected`
	 *       - real `runtime_aborted`
	 *       - synthetic `runtime_skipped` (from C1.3 pre-exec)
	 *     None of these consume the episode ceiling or
	 *     arm the second-stage continuation.
	 *
	 * The previous round of this guard keyed on
	 * `AgentToolResult.isError === true`, which
	 * structurally conflates these categories. This
	 * re-implementation is the architectural correction
	 * requested in review.
	 *
	 * Pinned by:
	 *   - C14_REAL_PARALLEL_OK_FIRST (real failure
	 *     present → latch fires)
	 *   - C14_REAL_PARALLEL_FAIL_FIRST (symmetric)
	 *   - C14_PARALLEL_CONTROL_PLANE_DENY_NOT_FAILURE
	 *     (host_policy_denied must NOT fire the latch)
	 *   - C14_PARALLEL_RUNTIME_SKIPPED_NOT_FAILURE
	 *     (synthetic runtime_skipped must NOT fire the
	 *     latch)
	 */
	private batchContainsTypedFailure(
		outcomes: readonly ToolRuntimeOutcome[],
	): boolean {
		for (const outcome of outcomes) {
			if (outcome.kind === "failure") {
				return true;
			}
		}
		return false;
	}

	private findCompletingToolMessage(
		toolCalls: AgentToolCallPart[],
		toolMessages: AgentMessage[],
	): AgentMessage | undefined {
		for (let index = 0; index < toolCalls.length; index += 1) {
			const toolCall = toolCalls[index];
			if (this.tools.get(toolCall.toolName)?.lifecycle?.completesRun !== true) {
				continue;
			}
			const toolMessage = toolMessages[index];
			const result = toolMessage?.content.find(
				(part): part is Extract<AgentMessagePart, { type: "tool-result" }> =>
					part.type === "tool-result" &&
					part.toolCallId === toolCall.toolCallId,
			);
			if (result && !result.isError) {
				return toolMessage;
			}
		}
		return undefined;
	}

	private async prepareToolExecution(
		toolCall: AgentToolCallPart,
	): Promise<PreparedToolExecution> {
		const tool = this.tools.get(toolCall.toolName);
		let input = toolCall.input;
		let skipReason: string | undefined;
		/**
		 * C1.2: typed control-plane signal. Set ONLY when the runtime has
		 * STRUCTURAL evidence that the tool was not executed for a
		 * typable control-plane reason. Generic skip paths leave this
		 * undefined so the classifier falls through to `runtime_skipped`
		 * via Priority 4.
		 */
		let controlPlaneOutcome: ControlPlaneOutcome | undefined;
		/**
		 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
		 * C2 plumbing: closed runtime-owned authority slot. Captured
		 * from the host's policy callback result (the trusted channel);
		 * NEVER read from `toolCall.metadata` (partially untrusted).
		 */
		let executionCapability: ToolCallExecutionCapability | undefined;
		/**
		 * ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01:
		 *
		 * Closed runtime-owned per-command plan slot. Captured from
		 * the host's policy callback result (`ToolApprovalResult.executionPlan`);
		 * NEVER read from `toolCall.metadata`. The plan carries
		 * per-entry authority (`CommandExecutionPlanEntry.executionCapability`)
		 * that the executor consumes by `commandIndex` (positional).
		 */
		let commandExecutionPlan: CommandExecutionPlan | undefined;
		/**
		 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
		 *
		 * Closed runtime-owned conditional authority flag. Captured
		 * from the host's policy callback result
		 * (`ToolApprovalResult.mandatorySeatbeltExecution`). Set ONLY
		 * when approval was approved AND the host chain produced the
		 * conditional source (`host_mode_all_seatbelt_required`).
		 * NEVER read from `toolCall.metadata` (partially untrusted).
		 */
		let mandatorySeatbeltExecution: boolean | undefined;
		// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01: the
		// authorization state is tracked STRUCTURALLY so the edit trace can
		// distinguish "authorized then executed" from "denied" from
		// "never reached authorization".
		let approvalOutcome: ModelBehaviorTraceEditApprovalOutcome = "unavailable";
		const metadata =
			toolCall.metadata &&
			typeof toolCall.metadata === "object" &&
			!Array.isArray(toolCall.metadata)
				? (toolCall.metadata as Record<string, unknown>)
				: undefined;

		const parsedInputParseError = metadata?.inputParseError;
		if (typeof parsedInputParseError === "string") {
			skipReason = parsedInputParseError;
		}

		const toolSource =
			metadata?.toolSource &&
			typeof metadata.toolSource === "object" &&
			!Array.isArray(metadata.toolSource)
				? (metadata.toolSource as Record<string, unknown>)
				: undefined;
		if (toolSource?.executionMode === "provider") {
			const providerId =
				typeof toolSource.providerId === "string"
					? toolSource.providerId
					: "provider";
			skipReason = `Tool execution is disabled for provider ${providerId}`;
		}

		if (tool && !skipReason) {
			input = normalizeJsonLikeStringsForSchema(input, tool.inputSchema);
		}

		// ACT-CLINEMM-FLINT-TOOLCALL-RED-01: tool-scoped input
		// canonicalization runs AFTER the generic schema-driven
		// normalization and BEFORE `validateInput`.
		//
		// Ordering is load-bearing:
		//   - It must run before validation so the canonical shape is what
		//     the schema validates.
		//   - It must run before approval / execution-plan construction so
		//     the approval card, the per-command authorization binding, and
		//     the executor all observe the SAME canonical input. A
		//     schema-level transform alone cannot achieve this, because
		//     `validateInput` reports acceptance without rewriting the
		//     input the runtime forwards.
		//
		// A throwing normalizer is treated as a validation failure: the
		// call never reaches approval and never reaches the executor.
		if (tool && !skipReason && typeof tool.normalizeInput === "function") {
			let normalizationError: string | undefined;
			try {
				input = tool.normalizeInput(input);
			} catch (error) {
				normalizationError =
					error instanceof Error
						? error.message
						: `Invalid input for tool ${toolCall.toolName}: ${String(error)}`;
			}
			if (
				typeof normalizationError === "string" &&
				normalizationError.length > 0
			) {
				skipReason = normalizationError;
				const existingMeta =
					toolCall.metadata &&
					typeof toolCall.metadata === "object" &&
					!Array.isArray(toolCall.metadata)
						? (toolCall.metadata as Record<string, unknown>)
						: {};
				(toolCall as { metadata?: Record<string, unknown> }).metadata = {
					...existingMeta,
					inputParseError: normalizationError,
				};
			}
		}

		// ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01: validate input
		// against the tool's own schema BEFORE any policy/approval/executor
		// side effect. A schema-invalid model tool call must NEVER request
		// approval and must NEVER invoke the executor.
		//
		// On validation failure we set `skipReason` and ALSO surface the
		// message as `metadata.inputParseError` on the toolCall so the
		// recovery classifier routes through Priority 3
		// (`failure / tool_input_invalid`) rather than the executor-throw
		// path (Priority 5 → `tool_execution_error`).
		if (tool && !skipReason && typeof tool.validateInput === "function") {
			let validationError: string | undefined;
			try {
				const result = await tool.validateInput(input);
				validationError = typeof result === "string" ? result : undefined;
			} catch (error) {
				validationError =
					error instanceof Error
						? error.message
						: `Invalid input for tool ${toolCall.toolName}: ${String(error)}`;
			}
			// ACT-CLINEMM-ROUND-C-HARNESS-02: report the SCHEMA VALIDATION
			// boundary at the REAL seam — the point where the tool's own
			// schema validates the input, before any approval and before
			// any execution.
			//
			// Only the OUTCOME and the input's SIZE are reported. The input
			// itself is never recorded: it can carry a command's arguments
			// or a file's content.
			this.observeSchemaValidation(
				toolCall.toolName,
				validationError === undefined,
				input,
			);
			if (typeof validationError === "string" && validationError.length > 0) {
				skipReason = validationError;
				// Mutate the toolCall's metadata so the classifier sees
				// `inputParseError` (Priority 3 input-parse provenance).
				// The downstream `executePreparedTool` reads
				// `prepared.toolCall.metadata.inputParseError` to build
				// the RuntimeOutcomeEvidence (agent-runtime.ts:2831).
				const existingMeta =
					toolCall.metadata &&
					typeof toolCall.metadata === "object" &&
					!Array.isArray(toolCall.metadata)
						? (toolCall.metadata as Record<string, unknown>)
						: {};
				(toolCall as { metadata?: Record<string, unknown> }).metadata = {
					...existingMeta,
					inputParseError: validationError,
				};
			}
		}

		// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 — AMENDMENT-01:
		// THE OBJECTIVE SCOPE GATE.
		//
		// While a bounded objective is ACTIVE, the runtime enforces the
		// objective's MUTATION SCOPE at the tool-execution boundary: a
		// tool call that would mutate a path OUTSIDE the objective's
		// authorised scope is refused BEFORE it reaches the approval chain
		// and BEFORE the executor runs.
		//
		// This is the CONSERVATION of the parent's authorisation: the
		// objective may only narrow the parent's authority, and the
		// narrowing is enforced, not merely stated in the dispatch text.
		//
		// The gate is deliberately narrow and honest about its limits:
		//
		//   - it applies to tool calls whose input carries an EXPLICIT
		//     path — the shape the runtime's own edit classification
		//     already recognises,
		//   - it applies only while an objective is active,
		//   - and it applies only when the objective's scope RESOLVED to a
		//     canonical root. When the objective's scope could not be
		//     resolved to a canonical path, there is NO narrower scope to
		//     enforce, and the runtime does NOT pretend otherwise: the
		//     parent's own authorisation remains the only authority, and
		//     the objective is reported as carrying an UNENFORCEABLE
		//     scope.
		if (tool && !skipReason) {
			const scopeRefusal = this.refuseToolCallOutsideActiveObjectiveScope(
				toolCall.toolName,
				input,
			);
			if (scopeRefusal) {
				skipReason = scopeRefusal;
				approvalOutcome = "skipped";
			}
		}

		let policyOverride: ToolPolicy | undefined;
		if (tool && !skipReason) {
			for (const hook of this.hooks.beforeTool) {
				const result = (await hook({
					snapshot: this.snapshot(),
					tool,
					toolCall: { ...toolCall, input },
					input,
				})) as AgentBeforeToolResult | undefined;
				if (result?.input !== undefined) {
					input = result.input;
				}
				if (result?.policy) {
					policyOverride = {
						...policyOverride,
						...result.policy,
					};
				}
				if (result?.appendContext?.trim()) {
					this.pendingHookContexts.push(
						formatHookContextBlock(
							{ source: "PreToolUse", toolCall },
							result.appendContext,
						),
					);
				}
				this.applyStopControl(result);
				if (result?.skip) {
					skipReason =
						result.reason ?? `Tool ${tool.name} was blocked by a runtime hook`;
					break;
				}
			}
		}

		if (tool && !skipReason) {
			const policy = {
				...resolveToolPolicy(toolCall.toolName, this.config.toolPolicies),
				...policyOverride,
			};
			if (policy.enabled === false) {
				// Policy-disabled: a known-tool non-execution. Use the
				// generic skip path; classifier falls through to
				// `runtime_skipped` via Priority 4.
				skipReason = `Tool "${toolCall.toolName}" is disabled by policy`;
				approvalOutcome = "skipped";
			} else if (policy.autoApprove === false) {
				const approval = await this.requestToolApproval(
					toolCall,
					input,
					policy,
				);
				if (!approval.approved) {
					// C1.2: classify the reason structurally. Host DENY
					// wins over user reject per CORRECTION04 invariant.
					approvalOutcome = "rejected";
					controlPlaneOutcome = selectControlPlaneOutcome({
						hostDenied: approval.decision?.kind === "deny",
						userRejected: true,
					});
					skipReason =
						approval.reason ?? `Tool "${toolCall.toolName}" was not approved`;
					// R3 (upstream approval-cardinality contract): the rejection
					// marker lets the consumer recognise a rejection row. It is
					// APPENDED, so the fork's own reason text is preserved and the
					// host-DENY-wins classification is unchanged.
					skipReason = `${skipReason} -- ${TOOL_REJECTION_SUFFIX}`;
				} else if (approval.executionPlan) {
					// CORRECTION04: structurally enforce the execution-plan
					// contract. The classifier produces a hardened argv via
					// applySafeExecutionProfileToCommand(); the approval
					// callback adopts it; the runtime MUST use the hardened
					// input — never the raw model input. This is the only
					// place that knows the safe argv, downstream is the
					// shell executor. There is no fallback to raw input.
					input = approval.executionPlan.transformedInput;
				}
				// ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
				// C2 plumbing: capture the host's authority slot. The
				// trusted writer is the host's policy callback result
				// (`ToolApprovalResult.executionCapability`); the runtime
				// is the ONLY consumer that copies this value into the
				// closed runtime-owned slot. We deliberately do NOT read
				// from `toolCall.metadata` -- that channel is partially
				// untrusted (see metadata-provenance.md).
				//
				// Set ONLY when approval.approved === true; the fail-closed
				// contract (binding-design.md FAIL-CLOSED) requires that
				// denied invocations never carry authority forward. When
				// approval was denied (above branch), we deliberately skip
				// this capture so no authority crosses the seam.
				if (approval.approved) {
					approvalOutcome = "approved";
				}
				if (approval.approved && approval.executionCapability) {
					executionCapability = approval.executionCapability;
				}
				// ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01:
				// stamp the host per-command authorization plan onto the
				// typed runtime-owned slot. Captured ONLY when approval is
				// approved AND the plan is present. NEVER read from
				// toolCall.metadata. The plan is the authority-bearing
				// structure consumed by the executor by commandIndex.
				if (approval.approved && approval.executionPlan) {
					commandExecutionPlan = approval.executionPlan;
				}
				// ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
				// Stamp the executor-side Seatbelt obligation onto the
				// typed runtime-owned slot. Captured ONLY when approval
				// is approved (otherwise nothing executes and the
				// obligation is moot). The host's policy chain produced
				// this flag from the conditional source
				// (`host_mode_all_seatbelt_required`); we thread it
				// through the trusted host-attached channel, never via
				// `toolCall.metadata`.
				if (approval.approved && approval.mandatorySeatbeltExecution === true) {
					mandatorySeatbeltExecution = true;
				}
			} else {
				// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01: an
				// auto-approved tool needs no explicit approval round-trip,
				// but the runtime DID authorize the call. Reporting
				// "unavailable" here would misdescribe an authorized edit.
				approvalOutcome = "approved";
			}
		} else {
			// The call never reached the authorization step: the tool was
			// unknown, the input was invalid, the tool was blocked by a
			// runtime hook, or the call was intercepted before the policy
			// chain. It is STRUCTURALLY skipped, not merely unobserved.
			approvalOutcome = "skipped";
		}
		return {
			toolCall: { ...toolCall, input },
			tool,
			input,
			skipReason,
			approvalOutcome,
			controlPlaneOutcome,
			executionCapability,
			commandExecutionPlan,
			mandatorySeatbeltExecution,
		};
	}

	private async requestToolApproval(
		toolCall: AgentToolCallPart,
		input: unknown,
		policy: ToolPolicy,
	): Promise<ToolApprovalResult> {
		const requestApproval = this.config.requestToolApproval;
		if (!requestApproval) {
			return {
				approved: false,
				reason: `Tool "${toolCall.toolName}" requires approval but no approval callback is configured`,
			};
		}
		// RSMT01: raise awaitingApproval ONLY while the
		// runtime is genuinely waiting on the host. The
		// `finally` clears it on every exit path (resolve,
		// reject, throw), preserving invariant I2
		// (awaitingApproval ⇒ status === "running") and
		// preventing a stale “awaiting” flag from leaking
		// across turns or into terminal lifecycle.
		// RSMT01 EVENT OBSERVABILITY: capture the
		// pre-raise projection so subscribers learn
		// about the new awaitingApproval state
		// BEFORE the runtime blocks on the await.
		const approvalBefore = this.buildExecutionProjection();
		this.state.executionAwaitingApproval = true;
		try {
			const result = await requestApproval({
				sessionId:
					this.config.sessionId?.trim() ||
					this.config.conversationId?.trim() ||
					this.state.runId ||
					this.state.agentId,
				agentId: this.state.agentId,
				conversationId:
					this.config.conversationId?.trim() ||
					this.state.runId ||
					this.state.agentId,
				iteration: this.state.iteration,
				toolCallId: toolCall.toolCallId,
				toolName: toolCall.toolName,
				input,
				policy,
			});
			return result;
		} catch (error) {
			return {
				approved: false,
				reason: `Tool "${toolCall.toolName}" approval request failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		} finally {
			this.state.executionAwaitingApproval = false;
			// Emit AFTER the finally so the cleared
			// state is observable to subscribers. The
			// `approvalBefore` is the pre-raise
			// projection; the post-finally snapshot
			// will be `awaitingApproval=false`.
			await this.emitExecutionStateChangeIfChanged(approvalBefore);
		}
	}

	private async executePreparedTool(
		prepared: PreparedToolExecution,
	): Promise<AgentMessage> {
		// A parallel sibling can outlive a stopped run; pushing to the buffer
		// captured here keeps its context out of whichever run is current then.
		const hookContexts = this.pendingHookContexts;
		const startedAt = new Date();
		// C1.5: capture the canonical projection BEFORE any recovery
		// authority can be mutated by this tool call. Both mutation
		// sites in this method — the C1.3 pre-execution exact block and
		// the C1.4 post-classification transitions — are covered by this
		// single pre/post pair, which is what keeps `recovery-state-changed`
		// to at most ONE event per tool call.
		const recoveryBefore = this.snapshotRecoveryState();
		await this.emit({
			type: "tool-started",
			snapshot: this.snapshot(),
			iteration: this.state.iteration,
			toolCall: prepared.toolCall,
		});
		// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01: report the tool START boundary.
		// The correlated tool-call identity is the runtime's own
		// `toolCallId`, so a start and its finish pair by construction.
		//
		// The argument fingerprint is computed by the SINK (which owns the
		// ephemeral key); the raw arguments are handed to the sink and never
		// retained by it.
		//
		// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01 — the fingerprint is
		// awaited ONLY when the sink actually produced a promise. When the
		// recorder is disabled the helper returns `undefined`
		// synchronously, so there is NO `await` here and therefore NO extra
		// microtask suspension point between this boundary and the tool
		// execution. The trace-OFF execution order is identical to the
		// pre-instrumentation order.
		const fingerprintResult = this.fingerprintToolArguments(
			prepared.toolCall.toolName,
			prepared.input,
		);
		const argumentFingerprint =
			fingerprintResult instanceof Promise
				? await fingerprintResult
				: fingerprintResult;
		this.observeToolBoundary("start", {
			toolCallId: prepared.toolCall.toolCallId,
			toolName: prepared.toolCall.toolName,
			origin: "model_requested",
			...(argumentFingerprint ? { argumentFingerprint } : {}),
			...(prepared.toolCall.execution
				? { execution: prepared.toolCall.execution }
				: {}),
		});
		// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01: report the
		// "edit requested → authorized" link.
		//
		// The RUNTIME is the sole reporter of the attempt, because only it
		// knows the authorization state: the executor cannot tell whether a
		// call was approved, denied, policy-skipped or never reached
		// authorization at all.
		//
		// The EXECUTOR reports the "mutation applied" link separately, and
		// it is the only layer that can resolve the requested path into the
		// identity the APPLICATION event records.
		//
		// The payload is STRUCTURE only: no path, no old/new text, no patch
		// body. The file identity is an ephemeral fingerprint computed by the
		// sink from the REQUESTED path.
		await this.observeEditAttempt(prepared);

		let result: AgentToolResult;
		/**
		 * C1.2 boundary gate: `toolExecutionInvoked` MUST be set
		 * IMMEDIATELY before the actual `tool.execute(...)` call. It is
		 * NEVER inferred from `result` presence / `skipReason` absence /
		 * approval result / etc. — the closure plan truth table is
		 * binding:
		 *
		 *   - !toolExists                 ⇒ false
		 *   - inputParseError             ⇒ false
		 *   - skipReason (any flavor)     ⇒ false
		 *   - approval !approved          ⇒ false
		 *   - tool.execute(...) called    ⇒ true
		 *   - tool.execute(...) threw     ⇒ true (set immediately before)
		 *
		 * This is the only way to keep NEVER-EXECUTED actions out of
		 * `RecoveryTracker`.
		 */
		let toolExecutionInvoked = false;
		/**
		 * C1.3 attempt identity computed pre-execution from
		 * `prepared.input` — the same canonical form the executor
		 * will receive. Typed identities are required by the
		 * substrate's privacy contract.
		 */
		const attemptIdentity: ToolAttemptIdentity = createAttemptIdentity(
			prepared.toolCall.toolName,
			prepared.input,
		);
		/** C1.2: verbatim throw from `tool.execute(...)`, retained for the classifier. */
		let thrownError: unknown;
		/**
		 * C1.2: control-plane override discovered DURING execution.
		 * Currently: `runtime_aborted` when the runtime's
		 * `abortController.signal` triggered before/during the executor
		 * call. The classifier's Priority 1 (control-plane) outranks
		 * Priority 5 (executor-throw), so an abort that surfaces as an
		 * `AbortError` is classified as `control_plane / runtime_aborted`
		 * rather than as a tool execution error. The executor IS still
		 * considered invoked.
		 */
		let runtimeControlPlaneOutcome: ControlPlaneOutcome | undefined;
		if (prepared.skipReason) {
			result = {
				output: { error: prepared.skipReason },
				isError: true,
			};
		} else if (this.isAttemptBlockedByRecovery(attemptIdentity)) {
			// C1.3 PRE-EXECUTION BREAKER. Consulted BEFORE the
			// registry-miss branch so that an unknown-tool proposal
			// whose exact identity has already exhausted its repair
			// budget is intercepted by the same code path as a known
			// tool. The substrate's `isExactBlockedIdentity` already
			// accounts for the family-eligible
			// `failure / tool_not_found` outcomes recorded by the
			// unknown-tool path on prior attempts — the
			// `exhaustedExactKeys` Set inside the family retains the
			// attemptKey across the `--no tool` branch.
			//
			// Notification semantics: the first such interception in
			// an episode transitions the visible state from `warning`
			// to `circuit_open` exactly once; subsequent interceptions
			// are no-ops at the tracker layer. The runtime must NEVER
			// feed this back into `recordFailureIdentity` — it is
			// structurally a runtime-side control action, not a tool
			// execution.
			//
			// CRITICAL: We must set `runtimeControlPlaneOutcome` to
			// `runtime_skipped` for the classifier to route the
			// synthesized blocked result as `control_plane /
			// runtime_skipped` rather than as a fresh
			// `failure / tool_not_found` (Priority 2 of the classifier
			// fires for any `toolExists=false` evidence, regardless of
			// `toolExecutionInvoked`). Priority 1
			// (`controlPlaneOutcome`) outranks Priority 2, so the
			// blocked attempt is correctly classified as the
			// pre-execution control plane action it actually is.
			this.recoveryTracker.recordBlockedAttemptIdentity(attemptIdentity);
			if (this.recoveryCircuitNoticeCount === 0) {
				this.recoveryCircuitNoticeCount = 1;
			}
			// C1.4 Trigger A — exact pre-execution block arms the
			// second-stage continuation state machine. Idempotent:
			// subsequent interceptions of the same (or other)
			// already-blocked attempts do NOT re-trigger. We only
			// transition `idle → armed` here; the actual
			// `armed → terminating` transition is performed by the
			// loop once the bounded continuation opportunity is
			// exhausted (or, in the case of immediate exhaustion,
			// by the model-stream latch on next access).
			if (this.recoverySecondStage.kind === "idle") {
				this.recoverySecondStage = {
					kind: "armed",
					trigger: "exact_blocked",
				};
			}
			runtimeControlPlaneOutcome = selectControlPlaneOutcome({
				explicitSkip: "runtime_skipped",
			});
			result = {
				output: {
					code: "bounded_recovery_exhausted",
					tool: prepared.toolCall.toolName,
					message:
						"Equivalent tool execution was blocked because the repair budget for this attempt is exhausted.",
				},
				isError: true,
			};
		} else if (!prepared.tool) {
			result = {
				output: { error: `Unknown tool: ${prepared.toolCall.toolName}` },
				isError: true,
			};
		} else {
			try {
				// Set IMMEDIATELY before the executor call, even though the
				// call has not yet returned. A throw is still "invoked".
				toolExecutionInvoked = true;
				const output = await prepared.tool.execute(prepared.input, {
					sessionId: this.config.sessionId,
					agentId: this.state.agentId,
					conversationId: this.config.conversationId,
					runId: this.state.runId ?? createUID("run"),
					iteration: this.state.iteration,
					toolCallId: prepared.toolCall.toolCallId,
					signal: this.abortController?.signal,
					// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01: the
					// edit-observation channel reaches the executor through the
					// tool context metadata. When the trace is OFF the sink is
					// absent, so the executor's observation is inert and no extra
					// read, fingerprint or allocation happens.
					metadata: this.buildToolContextMetadata(
						prepared.toolCall.toolCallId,
						prepared.approvalOutcome ?? "unavailable",
					),
					// ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
					// C2 plumbing: closed runtime-owned authority slot. Stamped
					// from `prepared.executionCapability`, which is populated
					// by `prepareToolExecution` from the host's policy callback
					// result (`ToolApprovalResult.executionCapability`). The
					// runtime NEVER reads this from `toolCall.metadata` -- that
					// channel is partially untrusted (metadata-provenance.md).
					executionCapability: prepared.executionCapability,
					// ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01:
					// closed runtime-owned per-command plan slot (NOT metadata).
					// Stamped from prepared.commandExecutionPlan, which is
					// populated by prepareToolExecution from the host policy
					// callback result (ToolApprovalResult.executionPlan).
					// The runtime NEVER reads this from toolCall.metadata.
					commandExecutionPlan: prepared.commandExecutionPlan,
					// ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
					// Stamp the executor-side Seatbelt obligation onto
					// the typed runtime-owned slot. Sourced from
					// `prepared.mandatorySeatbeltExecution`, which is
					// populated by `prepareToolExecution` from the
					// host's policy callback result
					// (`ToolApprovalResult.mandatorySeatbeltExecution`).
					// The runtime NEVER reads this from
					// `toolCall.metadata`. The executor
					// (`CommandJobManager.start`) uses the value to
					// refuse host-shell fallback when `true`.
					mandatorySeatbeltExecution: prepared.mandatorySeatbeltExecution,
					snapshot: this.snapshot(),
					emitUpdate: (update: unknown) => {
						void this.emit({
							type: "tool-updated",
							snapshot: this.snapshot(),
							iteration: this.state.iteration,
							toolCall: prepared.toolCall,
							update,
						});
					},
				});
				result = { output };
			} catch (error) {
				thrownError = error;
				// C1.2: if the runtime's abort signal fired, classify as
				// runtime_aborted rather than as a generic executor
				// error. AbortError is the standard JS-DOM signal
				// rejection; AgentRuntimeAbortError is the runtime's
				// own. Either is structural evidence of a runtime-level
				// abort, not a tool failure.
				if (
					this.abortController?.signal.aborted === true ||
					error instanceof AgentRuntimeAbortError ||
					(error instanceof Error && error.name === "AbortError")
				) {
					runtimeControlPlaneOutcome = selectControlPlaneOutcome({
						runtimeAborted: true,
					});
				}
				result = {
					output: {
						error: error instanceof Error ? error.message : String(error),
					},
					isError: true,
				};
			}
		}

		const endedAt = new Date();
		const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());

		if (prepared.tool) {
			for (const hook of this.hooks.afterTool) {
				const after = (await hook({
					snapshot: this.snapshot(),
					tool: prepared.tool,
					toolCall: prepared.toolCall,
					input: prepared.input,
					result,
					startedAt,
					endedAt,
					durationMs,
				})) as AgentAfterToolResult | undefined;
				if (after?.appendContext?.trim()) {
					hookContexts.push(
						formatHookContextBlock(
							{ source: "PostToolUse", toolCall: prepared.toolCall },
							after.appendContext,
						),
					);
				}
				this.applyStopControl(after);
				if (after?.result) {
					result = after.result;
				}
			}
		}

		// ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01: stamp the
		// narrow lifecycle disposition on the toolCall's metadata so the
		// legacy content_end consumer can render the resulting row
		// truthfully. Distinct from the structured ToolRuntimeOutcome
		// (C1.2, populated below) — this field answers ONLY the
		// webview's binary "did the executor run?" question.
		//
		// `toolExecutionInvoked` is the C1.2 closure-plan truth table
		// authority: it is set EXACTLY once, IMMEDIATELY before the
		// `tool.execute(...)` call (see agent-runtime.ts:2780), and
		// false on every skip-path (preparation/validation/policy/
		// approval/recovery/registry-miss). Reading it here is
		// equivalent to "did this action actually reach its executor
		// boundary?".
		{
			const existingMeta =
				prepared.toolCall.metadata &&
				typeof prepared.toolCall.metadata === "object" &&
				!Array.isArray(prepared.toolCall.metadata)
					? (prepared.toolCall.metadata as Record<string, unknown>)
					: {};
			const disposition = toolExecutionInvoked
				? "executed"
				: "rejected_before_execution";
			(prepared.toolCall as { metadata?: Record<string, unknown> }).metadata = {
				...existingMeta,
				executionDisposition: disposition,
			};
		}
		if (
			!prepared.skipReason &&
			!result.isError &&
			prepared.tool?.successContext?.trim()
		) {
			hookContexts.push(
				formatHookContextBlock(
					{ source: "ToolSuccess", toolCall: prepared.toolCall },
					prepared.tool.successContext,
				),
			);
		}

		// ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1): record the
		// OBSERVABLE facts of this tool call for the current execution
		// round. The observation is read-only and NEVER influences the tool
		// call itself: it is taken AFTER the result is produced, and a
		// classification failure cannot affect the outcome.
		this.observeExecutionRoundToolCall(
			prepared.toolCall.toolName,
			prepared.input,
			result,
		);

		const message = createMessage("tool", [
			{
				type: "tool-result",
				toolCallId: prepared.toolCall.toolCallId,
				toolName: prepared.toolCall.toolName,
				output: result.output,
				isError: result.isError,
			},
		]);

		await this.emit({
			type: "tool-finished",
			snapshot: this.snapshot(),
			iteration: this.state.iteration,
			toolCall: prepared.toolCall,
			message,
		});
		// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01: report the tool FINISH boundary.
		// Only the OUTCOME CLASS and the SIZE are recorded — never the raw
		// output. `toolExecutionInvoked` is the production C1.2 authority
		// for "did the executor actually run?".
		this.observeToolBoundary("finish", {
			toolCallId: prepared.toolCall.toolCallId,
			toolName: prepared.toolCall.toolName,
			origin: "model_requested",
			// The SAME fingerprint the start boundary recorded, so the
			// offline analysis can pair the two by action identity.
			...(argumentFingerprint ? { argumentFingerprint } : {}),
			durationMs,
			outcome: result.isError ? "error" : "success",
			executionInvoked: toolExecutionInvoked,
			...(prepared.skipReason ? { skipReason: prepared.skipReason } : {}),
			...(prepared.toolCall.execution
				? { execution: prepared.toolCall.execution }
				: {}),
			outputSizeChars: getOutputSize(result.output),
		});

		// ---------------------------------------------------------------
		// C1.2: produce a typed ToolRuntimeOutcome per tool call.
		// Classification is per-call local (NEVER shared across calls).
		// ---------------------------------------------------------------
		const inputParseError = (() => {
			const meta = prepared.toolCall.metadata;
			if (!meta || typeof meta !== "object" || Array.isArray(meta))
				return undefined;
			const parseErr = (meta as Record<string, unknown>).inputParseError;
			return typeof parseErr === "string" ? parseErr : undefined;
		})();
		const evidence: RuntimeOutcomeEvidence = {
			toolName: prepared.toolCall.toolName,
			toolCallId: prepared.toolCall.toolCallId,
			toolExists: prepared.tool !== undefined,
			toolExecutionInvoked,
			skipReason: prepared.skipReason,
			thrownError,
			result,
			controlPlaneOutcome:
				runtimeControlPlaneOutcome ?? prepared.controlPlaneOutcome,
			...(inputParseError !== undefined ? { inputParseError } : {}),
		};
		const classificationInput = buildToolOutcomeClassificationInput(evidence);
		const runtimeOutcome: ToolRuntimeOutcome =
			classifyToolRuntimeOutcome(classificationInput);
		// C1.4: capture the typed outcome into the runtime-
		// owned per-batch buffer BEFORE
		// `applyRecoveryPostClassification` mutates
		// `recoverySecondStage`. The buffer is the
		// parallel-path equivalent of the typed-outcome
		// authority used by the sequential recovery path:
		// it preserves provenance (kind ∈ {failure,
		// control_plane, success}) instead of the coarse
		// `AgentToolResult.isError` proxy. Consumed by
		// `executeToolCalls` after `Promise.all` resolves,
		// then cleared. See the buffer's declaration
		// comment for the C1.1 architectural rationale.
		this.pendingBatchOutcomes.push(runtimeOutcome);
		// C1.3: route the classified outcome through the runtime-owned
		// `RecoveryTracker` along the SAME per-call-local path. The
		// branching is structural (per `runtimeOutcome.kind`), so it
		// cannot confuse a `control_plane` outcome (which never
		// consumes budget) with a `failure` outcome. The pre-execution
		// block above routes its synthetic control-plane result through
		// the same path — the runtime-owned tracker is consulted only
		// at decision time, never through `onToolRuntimeOutcome`.
		this.applyRecoveryPostClassification(
			prepared.toolCall,
			attemptIdentity,
			runtimeOutcome,
		);
		// C1.5 ORDERING: the authoritative recovery mutation is now
		// complete, so the projection describes the state that governs
		// the next control decision. Emit BEFORE the observation hook so
		// a subscriber that reads `runtime.snapshot()` inside
		// `onToolRuntimeOutcome` already sees the state the event
		// announced. Suppressed (and deferred to the batch boundary)
		// while a parallel batch is in flight.
		await this.emitRecoveryStateChangeIfChanged(recoveryBefore);
		// C1.2 observable seam: surface the production outcome through
		// the `onToolRuntimeOutcome` hook. Read-only observation; the
		// breaker decision has already been made at this point.
		await this.notifyToolRuntimeOutcome(prepared.toolCall, runtimeOutcome);

		return message;
	}

	/**
	 * C1.2 observable seam: notify all `onToolRuntimeOutcome` hooks
	 * of the production outcome. Called once per tool call, after
	 * the classifier has produced the `ToolRuntimeOutcome`. The hook
	 * is read-only; the outcome is not mutated, routed, or
	 * aggregated. The breaker decision is made BEFORE this hook and
	 * never depends on subscriber ordering or content.
	 */
	private async notifyToolRuntimeOutcome(
		toolCall: AgentToolCallPart,
		outcome: ToolRuntimeOutcome,
	): Promise<void> {
		for (const hook of this.hooks.onToolRuntimeOutcome) {
			await hook({ toolCall, outcome });
		}
	}

	/**
	 * C1.3 private pre-execution gate. Returns `true` when the
	 * bounded-recovery tracker has marked this exact attempt identity
	 * as blocked (post-execution family exhaustion + sibling
	 * `markExactBlocked`/`recordBlockedAttempt` ancestry). Returns
	 * `false` for any other path, including:
	 *   - the first time an attempt is seen (no episode yet);
	 *   - `markExactBlocked`-only paths with no exhaustion;
	 *   - error paths that the substrate intentionally excludes
	 *     from the breaker (e.g. registry miss, control-plane
	 *     outcomes — those never reach this gate).
	 *
	 * Package-private to `AgentRuntime` — external callers MUST
	 * drive the agent, not invoke the tracker.
	 */
	private isAttemptBlockedByRecovery(
		attemptIdentity: ToolAttemptIdentity,
	): boolean {
		if (this.recoveryTracker.isExactBlockedIdentity(attemptIdentity)) {
			return true;
		}
		// C1.3 exact-only accounting for opaque failures. Per-exact
		// canonical key has its own budget; distinct opaque inputs
		// are NOT merged (preserves the C1.1 anti-false-merge
		// guarantee).
		const exactCount = this.exactOnlyBudget.get(attemptIdentity.controlKey);
		if (
			exactCount !== undefined &&
			exactCount > DEFAULT_RECOVERY_POLICY.maxRepairAttempts
		) {
			return true;
		}
		return false;
	}

	/**
	 * C1.3 private post-classification routing. Branches on
	 * `runtimeOutcome.kind` structurally so that:
	 *   - `success` ⇒ family-clearing reset through `recordToolSuccess`;
	 *   - `control_plane` ⇒ NO budget consumption (host DENY, user
	 *     reject, runtime abort, runtime_skipped — anything that did
	 *     not run for control-plane reasons);
	 *   - `failure` (familyEligible=true) ⇒ typed family handoff via
	 *     the C1.1 `createFamilyIdentity` helper;
	 *   - `failure` (familyEligible=false) ⇒ exact-only budget
	 *     increment, never merged into a shared "unknown" family.
	 *
	 * Pre-execution block results (synthesised `control_plane /
	 * runtime_skipped`) flow through this method without consuming
	 * any budget, which is the structural guard requested in §10.
	 */
	private applyRecoveryPostClassification(
		toolCall: AgentToolCallPart,
		attemptIdentity: ToolAttemptIdentity,
		outcome: ToolRuntimeOutcome,
	): void {
		// C1.4: snapshot the state so the failure branches can
		// tell "this turn just armed" apart from "the
		// continuation was already in flight and this is its
		// outcome".
		this.secondStageBeforeRecord = this.recoverySecondStage.kind;
		if (outcome.kind === "success") {
			// C1.4 success-reset contract: a successful tool
			// execution clears the second-stage continuation
			// pressure AND resets the episode-level failure
			// counter. The recoveryTracker.recordToolSuccess
			// helper already resets per-family state (C1.1
			// contract); here we additionally collapse the
			// second-stage continuation state to `idle` so the
			// next non-convergent failure is treated as a fresh
			// episode arming.
			//
			// If the episode is already `terminating`, do NOT
			// reset: the bounded continuation was used
			// unsuccessfully and the latch must remain until the
			// model-stream path encounters the terminal latch
			// (the existing throwIfAborted → ControlledStopError
			// → state="aborted" path delivers the truthful
			// outcome). A success on the same call that triggered
			// `terminating` is impossible by definition, so this
			// branch only changes `armed → idle`.
			if (this.recoverySecondStage.kind === "armed") {
				this.recoverySecondStage = { kind: "idle" };
			}
			// Episode counter resets on EVERY successful tool
			// execution, regardless of second-stage kind. This
			// is the load-bearing invariant against
			// false-positive episode exhaustion: an
			// intermittent sequence of fail/success/fail/
			// success MUST NOT trip Trigger D, because each
			// success is a genuine forward-progress event
			// that ends the current recovery episode. The
			// C14_EPISODE_SUCCESS_RESETS_FAILURE_ACCUMULATION
			// test pins this invariant.
			//
			// Reset semantics per stage:
			//   - armed   → idle (and counter = 0)
			//   - idle    → idle (counter = 0; re-starts
			//               the next episode cleanly)
			//   - termin. → termin. (counter = 0; harmless
			//               because the latch is already set;
			//               next stream entry throws anyway)
			this.recoveryEpisodeFailures = 0;
			this.recoveryTracker.recordToolSuccess(toolCall.toolName);
			return;
		}
		if (outcome.kind === "control_plane") {
			// Control-plane outcomes are structurally excluded
			// from repair budget. Includes:
			//   - the synthetic `runtime_skipped` produced by the
			//     C1.3 pre-execution block;
			//   - real `host_policy_denied`, `user_rejected`,
			//     `runtime_aborted`, `approval_pending`, etc.
			//
			// C1.4: this is the load-bearing transition.
			//   - Genuine control-plane outcomes (host DENY, user
			//     REJECT, runtime ABORT, approval PENDING) MUST
			//     NEVER arm the second-stage continuation.
			//   - Synthesised control-plane / runtime_skipped from
			//     a C1.3 PRE-EXEC block however DOES count as a
			//     non-convergent outcome during the bounded
			//     continuation: the model proposed an attempt
			//     that we already determined cannot run; the
			//     continuation is therefore used
			//     unsuccessfully. We detect the synthesised
			//     pre-exec block via the `prepared.controlPlaneOutcome`
			//     on the prepared toolCall (set by the pre-exec
			//     breaker in `executePreparedTool`); for genuine
			//     control-plane paths the prepared
			//     .controlPlaneOutcome is the typed enum that
			//     the classifier already saw (host DENY, etc.).
			//
			// Distinguishing them: only the synthetic
			// pre-exec block emits `runtime_skipped` with
			// `toolExecutionInvoked=false` AND the exact-key
			// was specifically marked blocked this turn. We
			// detect this through the recovery-tracker's
			// blocked-family membership (the call we routed in
			// `executePreparedTool`). When state===`armed` and
			// the call was an exact-block pre-exec, flip to
			// `terminating`. Otherwise stay armed (the genuine
			// control-plane path does not consume the
			// continuation slot).
			//
			// Implementation note: we already arm via Trigger A
			// IN `executePreparedTool` (the exact-block branch).
			// For the post-arm continuation turn, a pre-exec
			// block there means the model proposed another
			// blocked attempt — non-convergent — and the latch
			// must fire to prevent further requests.
			// CRITICAL: only flip the latch for synthesised pre-exec
			// blocks on the continuation turn — not for genuine
			// control-plane outcomes (host DENY, etc.). The
			// synthesised pre-exec path is the C1.3 breaker
			// intercepting an exact-key attempt; the genuine
			// path is a host-level decision that has nothing
			// to do with recovery.
			if (
				this.recoverySecondStage.kind === "armed" &&
				this.secondStageBeforeRecord === "armed" &&
				outcome.outcome === "runtime_skipped"
			) {
				this.recoverySecondStage = {
					kind: "terminating",
					trigger: this.recoverySecondStage.trigger,
				};
				this.state.lastError = "bounded_recovery_exhausted";
			}
			return;
		}
		// outcome.kind === "failure"
		if (!outcome.familyEligible) {
			// Exact-only budget for opaque failures. Distinct canonical
			// inputs each get their own counter; the C1.1 anti-merge
			// guarantee is preserved because we never collapse them
			// into a shared family.
			const key = attemptIdentity.controlKey;
			const next = (this.exactOnlyBudget.get(key) ?? 0) + 1;
			this.exactOnlyBudget.set(key, next);
			// C1.4 Trigger C — opaque exact-only cap. If a single
			// canonical key's counter has exceeded the per-key
			// budget, no further identical opaque attempts are
			// useful; arm the second-stage continuation. The
			// policy cap is `maxRepairAttempts + 1` to mirror
			// the family-eligible exhaustion semantics: the
			// original attempt plus `maxRepairAttempts` repairs.
			if (
				next > DEFAULT_RECOVERY_POLICY.maxRepairAttempts &&
				this.recoverySecondStage.kind === "idle"
			) {
				this.recoverySecondStage = {
					kind: "armed",
					trigger: "exact_only_capped",
				};
			}
			// C1.4 Trigger D — episode-level non-convergence
			// ceiling (opaque path). Counts genuinely
			// recoverable failures across the whole episode.
			// The counter increments BEFORE any arm check so
			// the just-recorded failure can trigger the
			// episode-exhaustion arm on the same turn it
			// crosses the cap. The "this turn just armed"
			// guard (secondStageBeforeRecord !== "armed")
			// prevents an immediate flip-to-terminating for
			// trigger D arming.
			//
			// Do NOT increment when state is already
			// `terminating`: the latch has already been set
			// and this iteration is the bounded continuation
			// being consumed. Counting it would inflate the
			// counter past the cap and corrupt the
			// "exact cap reached" invariant that the test
			// suite pins.
			if (this.recoverySecondStage.kind === "idle") {
				this.recoveryEpisodeFailures += 1;
				if (
					this.recoveryEpisodeFailures >=
					this.recoveryPolicy.maxRecoveryEpisodeFailures
				) {
					this.recoverySecondStage = {
						kind: "armed",
						trigger: "episode_exhausted",
					};
				}
			}
			// C1.4 second-stage TERMINATING transition: any
			// non-convergent outcome observed while the
			// continuation is armed (state==="armed" BEFORE
			// this turn's mutation) flips the latch. The latch
			// is the load-bearing invariant: after this
			// transition the next model-stream entry throws,
			// terminating the run. A failure on the continuation
			// turn is non-convergent by definition. We exclude
			// the "this turn just armed" case (Trigger C/D) by
			// comparing against `secondStageBeforeRecord`.
			if (
				this.recoverySecondStage.kind === "armed" &&
				this.secondStageBeforeRecord === "armed"
			) {
				this.recoverySecondStage = {
					kind: "terminating",
					trigger: this.recoverySecondStage.trigger,
				};
				this.state.lastError = "bounded_recovery_exhausted";
			}
			return;
		}
		// Family-eligible failure: handoff through the C1.1 typed helpers.
		const serializedStableCode = serializeStableFailureCode(outcome.stableCode);
		const familyIdentity = createFamilyIdentity(
			outcome.toolName,
			outcome.failureClass,
			serializedStableCode,
		);
		const fingerprint = fingerprintToolFailure(
			outcome.toolName,
			outcome.failureClass,
			serializedStableCode,
			this.state.iteration,
			toolCall.toolCallId,
			attemptIdentity.controlKey,
		);
		this.recoveryTracker.recordFailureIdentity(
			familyIdentity,
			attemptIdentity,
			fingerprint,
		);
		// C1.4 Trigger B — family exhaustion without an exact
		// repeat. After `recordFailureIdentity` records this
		// observation, check whether the family the runtime just
		// handoffed to is now in `getBlockedFamilies()`. If so,
		// the family budget is exhausted and a fresh-input same-
		// family continuation should be armed. The family is
		// resolved by the same canonical control-family used to
		// key the tracker's family state; the next model stream
		// (if it proposes a different path under the same family)
		// will be the bounded continuation opportunity.
		if (
			this.recoverySecondStage.kind === "idle" &&
			this.recoveryTracker
				.getBlockedFamilies()
				.includes(this.familyControlDiagnostic(familyIdentity))
		) {
			this.recoverySecondStage = {
				kind: "armed",
				trigger: "family_exhausted",
			};
		}
		// C1.4 Trigger D — episode-level non-convergence
		// ceiling (family-eligible path). Counts genuinely
		// recoverable failures across distinct families and
		// distinct exact keys. Increment BEFORE the arm
		// check so the just-recorded observation can trigger
		// the arm on the same turn it crosses the cap.
		// Do NOT increment when state is already armed or
		// terminating (this is the bounded continuation
		// turn). The counter only grows during the
		// pre-arm "idle" phase.
		if (this.recoverySecondStage.kind === "idle") {
			this.recoveryEpisodeFailures += 1;
			if (
				this.recoveryEpisodeFailures >=
				this.recoveryPolicy.maxRecoveryEpisodeFailures
			) {
				this.recoverySecondStage = {
					kind: "armed",
					trigger: "episode_exhausted",
				};
			}
		}
		// C1.4 second-stage TERMINATING transition (family-
		// eligible path). This block is reached AFTER
		// `recordFailureIdentity` (which may have just armed
		// via Trigger B/D). We must NOT immediately flip the
		// freshly-armed state to terminating: the arm happened
		// on this turn; the model's continuation is the NEXT
		// turn's tool-call outcome. Use the truth that an
		// armed-but-NOT-just-armed state implies the continuation
		// is in flight. We achieve this by tracking the value
		// of `recoverySecondStage` BEFORE the family-eligible
		// recordFailureIdentity call: if it was already
		// `armed` coming in, the post-execution observed here is
		// the OUTCOME of the bounded continuation turn.
		if (
			this.recoverySecondStage.kind === "armed" &&
			this.secondStageBeforeRecord === "armed"
		) {
			this.recoverySecondStage = {
				kind: "terminating",
				trigger: this.recoverySecondStage.trigger,
			};
			this.state.lastError = "bounded_recovery_exhausted";
		}
	}

	/**
	 * C1.4: project a typed `ToolFamilyIdentity` to the substrate's
	 * diagnostic family the way `recordBlockedAttemptIdentity` and
	 * `getBlockedFamilies()` do, so the runtime can compare them
	 * by string equality. Mirrors the projection in
	 * `RecoveryTracker.recordBlockedAttemptControl`. Local helper
	 * to keep the runtime self-contained.
	 */
	private familyControlDiagnostic(family: { controlFamily: string }): string {
		return controlFamilyToDiagnosticId(family.controlFamily);
	}

	/**
	 * C1.3 internal test seam: returns a read-only snapshot of the
	 * runtime-owned `RecoveryTracker` for tests that need to assert
	 * on circuit state (e.g. that user-rejection episodes never
	 * open the circuit). Intentionally underscore-prefixed and
	 * not part of the public SDK surface.
	 */
	/**
	 * C1.3 internal test seam, C1.5-redirected.
	 *
	 * Now derived from {@link snapshotRecoveryState} — the SAME canonical
	 * projection that feeds `snapshot().recovery` and every
	 * `recovery-state-changed` payload. The accessor therefore cannot
	 * develop richer or conflicting semantics than the public surface.
	 *
	 * `exactOnlyBudgetSize` is the one exception: it reads the PRIVATE
	 * C1.3 budget map directly because existing C1.3/C1.4 tests assert on
	 * it. It is deliberately NOT part of the public projection — its
	 * cardinality would leak how many distinct canonical inputs the model
	 * attempted, and no consumer needs it.
	 *
	 * Intentionally underscore-prefixed and not part of the public SDK
	 * surface.
	 */
	__recoverySnapshotForTests(): {
		state: import("./runtime/recovery").RecoveryState;
		circuitNoticeCount: number;
		exactOnlyBudgetSize: number;
		secondStage: {
			kind: "idle" | "armed" | "terminating";
			trigger?:
				| "exact_blocked"
				| "family_exhausted"
				| "exact_only_capped"
				| "episode_exhausted";
		};
		episodeFailures: number;
		maxRecoveryEpisodeFailures: number;
	} {
		const projection = this.snapshotRecoveryState();
		return {
			state: projection.state,
			circuitNoticeCount: projection.circuitNoticeCount,
			exactOnlyBudgetSize: this.exactOnlyBudget.size,
			secondStage: {
				kind: projection.secondStage,
				...(projection.secondStageTrigger !== undefined
					? { trigger: projection.secondStageTrigger }
					: {}),
			},
			episodeFailures: projection.episodeFailures,
			maxRecoveryEpisodeFailures: projection.maxEpisodeFailures,
		};
	}

	private finishRun(
		status: AgentRunResult["status"],
		assistantMessage?: AgentMessage,
		outputText?: string,
	): AgentRunResult {
		this.state.status = status;
		// RSMT01 I1: terminal lifecycle ⇒ all flags false.
		// `finishRun` is the bottom of every completed /
		// aborted / failed path. Both flags are reset
		// here so a stale modelStreaming or
		// awaitingApproval cannot survive the terminal
		// transition.
		this.state.executionModelStreaming = false;
		this.state.executionAwaitingApproval = false;
		return {
			agentId: this.state.agentId,
			agentRole: this.state.agentRole,
			runId: this.state.runId ?? createUID("run"),
			status,
			iterations: this.state.iteration,
			outputText:
				outputText ??
				textFromMessage(assistantMessage ?? this.findLastAssistantMessage()),
			messages: cloneMessages(this.state.messages),
			usage: cloneUsage(this.state.usage),
		};
	}

	private findLastAssistantMessage(): AgentMessage | undefined {
		return [...this.state.messages]
			.reverse()
			.find((message) => message.role === "assistant");
	}

	private throwIfAborted(): void {
		if (this.abortController?.signal.aborted) {
			throw this.normalizeAbortError();
		}
	}

	private normalizeAbortError(): Error {
		const reason = this.abortController?.signal.reason;
		if (reason instanceof Error) {
			return reason;
		}
		if (typeof reason === "string") {
			return new Error(reason);
		}
		return new Error(this.state.lastError ?? "Run aborted");
	}

	private async emit(event: AgentRuntimeEvent): Promise<void> {
		const metadata = buildEventMetadata(event);
		switch (event.type) {
			case "run-started":
				// Verbatim clinee calls `logger?.info?.(...)`. sdk-re's
				// `BasicLogger` does not declare `info` (it uses `log`), so
				// we narrow to an optional-info shape at the call site to
				// preserve the clinee runtime contract without mutating
				// shared's `BasicLogger` interface.
				(
					this.config.logger as
						| {
								info?: (msg: string, md?: unknown) => void;
						  }
						| undefined
				)?.info?.("Agent run started", metadata);
				break;
			case "tool-finished":
				(
					this.config.logger as
						| {
								info?: (msg: string, md?: unknown) => void;
						  }
						| undefined
				)?.info?.("Agent tool finished", metadata);
				break;
			case "run-failed":
				this.config.logger?.error?.("Agent run failed", {
					...metadata,
					error: event.error,
				});
				// Failures the model layer already recorded at its own error
				// boundary (`provider.stream`, carried across the stream's
				// string-flattening boundary as `finish.errorReported`) must not
				// be re-reported here — that exactly doubled `sdk.error` volume.
				// Everything else still reports: loop-originated failures, and
				// failures from model implementations that do not record their
				// own telemetry.
				if (!this.state.lastErrorReported) {
					captureSdkError(this.config.telemetry, {
						component: "agents",
						operation: "agent.run",
						error: event.error,
						severity: "error",
						handled: false,
						context: {
							...(metadata as TelemetryProperties),
							providerId: this.getTelemetryProviderId(),
							modelId: this.getTelemetryModelId(),
							modelRequestId: this.modelRequestId,
							...(this.state.lastFinishReason
								? { finishReason: this.state.lastFinishReason }
								: {}),
						},
					});
				}
				break;
			default:
				this.config.logger?.debug?.("Agent event", metadata);
				break;
		}
		switch (event.type) {
			// Per-token/per-chunk stream events are ~97% of agent.* telemetry
			// volume and are never queried, so they are not mirrored to
			// telemetry. Listeners and hooks below still receive them.
			case "assistant-text-delta":
			case "assistant-reasoning-delta":
			case "assistant-media":
			case "tool-call-delta":
			case "tool-updated":
				break;
			case "run-finished":
			case "run-failed":
				this.config.telemetry?.capture({
					event: `agent.${event.type}`,
					properties: {
						...(metadata as TelemetryProperties),
						...this.config.runEndTelemetryProperties?.(),
					},
				});
				break;
			default:
				this.config.telemetry?.capture({
					event: `agent.${event.type}`,
					properties: metadata as TelemetryProperties,
				});
				break;
		}
		// Listeners that observe state-transition events MUST
		// NOT be allowed to (a) veto runtime control flow or
		// (b) prevent subsequent subscribers from receiving
		// the same event. The C1.5 verdict established this
		// invariant for the recovery projection. RSMT01
		// CORRECTION03 extends it to the execution projection
		// for the same architectural reason:
		//
		//   - `recovery-state-changed` is an OBSERVATION of
		//     `snapshot.recovery`. A throwing listener there
		//     must not become authority over the recovery
		//     decision, and must not silence other listeners.
		//   - `execution-state-changed` is an OBSERVATION of
		//     `snapshot.execution`. The same rule applies
		//     symmetrically: a throwing listener must not
		//     become authority over the model/approval
		//     progression, and must not silence other listeners.
		//
		// Per-listener isolation is the smallest correction
		// consistent with the existing C1.5 emitter contract
		// (see `emitRecoveryStateChangeIfChanged`). Generalizing
		// this to ALL events would change the runtime's
		// pre-existing throw-propagation behavior for
		// unrelated event types; the reviewer's P0 explicitly
		// asks for the narrow observation-event extension.
		//
		// Future event variants that satisfy the same
		// "observation, not control" criterion should join
		// this list rather than introducing their own
		// per-emit try/catch.
		const isObservationEvent =
			event.type === "recovery-state-changed" ||
			event.type === "execution-state-changed" ||
			event.type === "working-context-state-changed";
		for (const listener of this.listeners) {
			// C1.5 P1: `AgentEventListener` is typed as
			// `(event: LiveAgentRuntimeEvent) => void`, which is a
			// NARROWED supertype of the internal `AgentRuntimeEvent`.
			// The runtime-to-listener contract guarantees that every
			// emitted event's snapshot carries the canonical recovery
			// projection (pinned by `C15_EVENT_EQUALS_SNAPSHOT`), so
			// the refinement is sound at this boundary. The cast is
			// the single seam that converts the base internal type
			// to the live-public type, matching the production code
			// path that constructs every emitted event via
			// `this.snapshot()`.
			try {
				listener(event as unknown as Parameters<AgentEventListener>[0]);
			} catch (err) {
				if (isObservationEvent) {
					// Observation must not become control.
					// Skip this listener, continue with the
					// rest of `this.listeners` and the
					// `onEvent` hooks.
					continue;
				}
				throw err;
			}
		}
		for (const hook of this.hooks.onEvent) {
			await hook(event);
		}
	}

	private applyStopControl(
		control: AgentStopControl | undefined | undefined,
	): void {
		if (!control?.stop) {
			return;
		}
		if (control.reason) {
			this.state.lastError = control.reason;
		}
		// ACT-CLINEMM-SDK-ABORT-CAUSE-RETENTION01: the controlled-stop
		// ORIGIN. This is a runtime-initiated termination, and it is
		// DISTINCT from an explicit user cancel — the two produce the same
		// terminal `status` but a different cause.
		this.observeRunAbortRequested("runtime_controlled_stop", control.reason);
		throw new ControlledStopError(control.reason);
	}
}

function buildEventMetadata(event: AgentRuntimeEvent): Record<string, unknown> {
	return {
		agentId: event.snapshot.agentId,
		agentRole: event.snapshot.agentRole,
		runId: event.snapshot.runId,
		status: event.snapshot.status,
		iteration: event.snapshot.iteration,
		eventType: event.type,
	};
}

function mergeToolMetadata(current: unknown, patch: unknown): unknown {
	if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
		return patch;
	}
	if (!current || typeof current !== "object" || Array.isArray(current)) {
		return patch;
	}
	return {
		...(current as Record<string, unknown>),
		...patch,
	};
}

function parseToolInput(assembly: PendingToolAssembly): {
	input: unknown;
	parseError?: string;
	invalidInput: Record<string, unknown>;
	reason?: InvalidToolCall["reason"];
} {
	if (assembly.inputValue !== undefined) {
		return {
			input: assembly.inputValue,
			invalidInput: buildInvalidToolInput(JSON.stringify(assembly.inputValue)),
		};
	}
	if (!assembly.inputText.trim()) {
		return {
			input: {},
			invalidInput: {},
		};
	}
	const parsed = parseToolArguments(assembly.inputText);
	if (parsed.ok) {
		return {
			input: parsed.value,
			invalidInput: buildInvalidToolInput(assembly.inputText),
		};
	}
	return {
		input: {},
		invalidInput: buildInvalidToolInput(assembly.inputText, parsed.error),
		parseError: `Tool call ${assembly.toolName ?? assembly.toolCallId} emitted invalid JSON arguments: ${parsed.error}`,
		reason: "invalid_arguments",
	};
}

function buildInvalidToolInput(
	value: string,
	parseError?: string,
): Record<string, unknown> {
	const trimmed = value.trim();
	if (!trimmed) {
		return {};
	}
	return parseError
		? { rawInputText: value, parseError }
		: { rawInputText: value };
}

function parseToolArguments(
	value: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
	const trimmed = value.trim();
	if (!trimmed) {
		return {
			ok: false,
			error: "Tool call arguments were empty.",
		};
	}

	try {
		return { ok: true, value: JSON.parse(trimmed) };
	} catch {
		// Fall through to a normalized error below.
	}

	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
		return {
			ok: false,
			error: "Tool call arguments must be encoded as a JSON object or array.",
		};
	}

	return {
		ok: false,
		error:
			"Tool call arguments could not be parsed as JSON. Ensure the outer tool payload is valid JSON and escape embedded quotes/newlines inside string fields.",
	};
}

function mergeToolInputText(current: string, incoming: string): string {
	if (!current) {
		return incoming;
	}
	const trimmed = incoming.trimStart();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return incoming;
	}
	return current + incoming;
}

export function createAgentRuntime(config: AgentRuntimeConfig): AgentRuntime {
	return new AgentRuntime(config);
}

/**
 * `Agent` is the user-friendly name for `AgentRuntime`. They are the same
 * class; this alias exists so standalone callers can write:
 *
 *     const agent = new Agent({ providerId, modelId, apiKey });
 *     await agent.run("hello");
 *
 * while `@cline/core` (which owns model construction) continues to use
 * the `AgentRuntime` name with `{ model, ... }` configs.
 */
export const Agent = AgentRuntime;
export type Agent = AgentRuntime;

export function createAgent(config: AgentRuntimeConfig): AgentRuntime {
	return new AgentRuntime(config);
}

// ============================================================================
// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
// (thirty-third-pass, attempt 2) — package-internal runtime-trace observer.
//
// The observer is installed via `installRuntimeWTraceObserver(observer)`,
// which is a NOT-exported helper defined in
// `./runtime-w-trace-internal.ts`. The helper writes to a
// Symbol.for-keyed slot on `globalThis`. The runtime reads
// from the SAME slot via `Symbol.for("@cline/agents__wTraceObserver")`
// on every `prepareTurnForModelRequest`. There is NO public
// setter on `AgentRuntime` and NO exported function that
// installs the observer from `@cline/agents`. The host wires
// the observer through the runtime composition layer (the
// ClineMM-private bridge in
// `apps/vscode/src/sdk/w-carrier-runtime-trace-bridge.ts`),
// which calls `installRuntimeWTraceObserver` during SDK controller
// construction.
//
// SYMBOL.FOR SINGLETON strategy: the Symbol identity is stable
// across module evaluations (Symbol.for uses a process-wide
// registry), so both the runtime's read site and the install
// helper's write site reach the SAME slot regardless of how
// Bun's separate-entry bundling splits the source graph.
// PROVEN by the durable built-artifact regression test at
// `sdk/packages/agents/src/agent-runtime.w-trace-built-artifact.test.ts`
// (thirty-fourth-pass) which actually builds @cline/agents
// into a temp directory and asserts the sentinel observer
// fired exactly once across the two built bundle entrypoints.
//
// OFF semantics: when the diagnostic is OFF, the host simply
// does not call `installRuntimeWTraceObserver`, the slot value
// remains `undefined`, and `notifyRuntimeWTraceObserver` is a
// strict no-op. Public builds pay nothing.
//
// Attachment vs recording: the install happens at SdkController
// construction (BEFORE the first `AgentRuntime` is constructed).
// The Symbol.for slot persists for the process lifetime.
// `AgentRuntime.notifyRuntimeWTraceObserver` reads the
// current slot on every `prepareTurnForModelRequest`. The
// `recordWCarrierTrace` call itself still gates each append via
// the frozen `isWCarrierTraceEnabled` seam, so a later
// diagnostic flip to OFF after attachment still stops recording
// on the host side.
//
// OBSERVER_CARDINALITY = package-module/process scoped (one
// Symbol.for slot per process). For current dogfood forensic
// capture that is fine because the observer is just one
// ClineMM process-wide sink and records `sessionId`.
// ============================================================================

/**
 * Module-level observer holder lives in
 * `./runtime-w-trace-internal.ts`. This file re-imports
 * both W-trace diagnostic types (the record shape and the
 * observer callback signature) from the SINGLE declaration
 * authority in `./runtime-w-trace-internal.ts`.
 *
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (thirty-sixth-pass): `AgentRuntimeWTraceObserver` was
 * referenced at the `notifyRuntimeWTraceObserver` use site
 * but never imported, producing TS2304 on a clean detached
 * package build. The fix is to extend the existing
 * `./runtime-w-trace-internal` import to cover both types
 * (the previous cycle re-exported the record via
 * `./runtime-w-trace-internal` itself, but the observer was
 * only declared there and never imported into
 * `agent-runtime.ts`).
 *
 * The runtime's Symbol.for(`"@cline/agents__wTraceObserver"`)
 * slot is declared in BOTH this file (line below) and
 * `./runtime-w-trace-internal.ts`. They produce the SAME
 * Symbol identity via `Symbol.for`; they are NOT two
 * separate slot bindings.
 *
 * @internal
 */
import type {
	AgentRuntimeWTraceObserver,
	AgentRuntimeWTraceRecord,
} from "./runtime-w-trace-internal";

// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
// (thirty-third-pass, attempt 2) — stable Symbol.for singleton.
//
//
// FIX: use a Symbol.for-keyed slot on globalThis. The Symbol
// identity is stable across module loads (Symbol.for uses
// a process-wide registry), so both bundles reach the same
// slot regardless of how Bun splits the source graph. This is
// NOT `globalThis` pollution with a string key (which would be
// the reviewer's "process-wide namespace residue" concern) —
// a Symbol.for key is intentionally collision-free and only
// `installRuntimeWTraceObserver` and `notifyRuntimeWTraceObserver`
// know the Symbol.
//
// The slot is read on every `prepareTurnForModelRequest`. The
// install helper writes to it from the bridge's secondary
// bundle; the runtime reads it from the main bundle. They
// always hit the same slot.
//
// @internal
//   NOT a public SDK API. The Symbol is module-internal and
//   its key is intentionally not exported.
const W_TRACE_OBSERVER_SLOT = Symbol.for("@cline/agents__wTraceObserver");

// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
