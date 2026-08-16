import {
	classifyProviderError,
	createGateway,
	type GatewayProviderSettings,
} from "@cline/llms";
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
	AgentRuntimeExecutionState,
	CaptureTaskLifecycleEventInput,
	ControlPlaneOutcome,
	LiveAgentRuntimeEvent,
	LiveAgentRuntimeStateSnapshot,
	ProviderErrorClass,
	TelemetryProperties,
	ToolApprovalResult,
	ToolPolicy,
	ToolRuntimeOutcome,
} from "@cline/shared";
import {
	captureAgentUnexpectedReasoningTokens,
	captureSdkError,
	captureTaskLifecycleEvent,
	estimateTokens,
	mergeModelOptions,
	normalizeJsonLikeStringsForSchema,
	omitUndefinedValues,
	TASK_CANCELLED_EVENT,
	TASK_FIRST_CHUNK_RECEIVED_EVENT,
	TASK_PROVIDER_REQUEST_STARTED_EVENT,
	TASK_PROVIDER_STREAM_FAILED_EVENT,
	TASK_PROVIDER_STREAM_STARTED_EVENT,
	trimNonEmpty,
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
import {
	buildExecutionState,
	isSameExecutionState,
} from "./runtime/state";

const MAX_TOKENS_INCOMPLETE_TURN_MESSAGE =
	"Model reached the maximum output token limit before completing the turn";

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
		lastErrorClass: undefined as ProviderErrorClass | undefined,
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
	};
	/** One automatic overflow-recovery attempt per run. */
	private overflowRecoveryAttempted = false;
	private initialization?: Promise<void>;
	private abortController?: AbortController;
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

	abort(reason?: unknown): void {
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
		this.state.lastErrorReported = false;
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
		return `[SYSTEM] This run is not complete until you call one of these terminal completion tools: ${terminalToolNames.join(
			", ",
		)}. Continue working if requirements are not met. If the task is complete, call the appropriate terminal completion tool now.`;
	}

	private getCompletionReminderMessages(): string[] {
		return [
			this.getCompletionToolReminderMessage(),
			this.config.completionPolicy?.completionGuard?.(),
		].filter((message): message is string => Boolean(message));
	}

	private async addUserReminderMessage(text: string): Promise<AgentMessage> {
		const reminderMessage = createMessage("user", [{ type: "text", text }], {
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

	private async execute(input?: AgentRunInput): Promise<AgentRunResult> {
		await this.ensureInitialized();
		if (this.state.status === "running") {
			throw new Error("Agent runtime is already running");
		}

		this.abortController = new AbortController();
		this.state.runId = createUID("run");
		this.state.status = "running";
		this.state.iteration = 0;
		this.state.pendingToolCalls = [];
		this.state.lastError = undefined;
		this.state.lastErrorClass = undefined;
		this.state.lastErrorReported = false;
		// RSMT01: next-run freshness. The execution
		// authority flags MUST be cleared at the start of
		// every run so a prior run's stale
		// "modelStreaming" or "awaitingApproval" cannot
		// leak across the run boundary. Pinned by RSM14.
		this.state.executionModelStreaming = false;
		this.state.executionAwaitingApproval = false;
		this.state.usage = cloneUsage(DEFAULT_USAGE);
		this.overflowRecoveryAttempted = false;

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

			let finalAssistantMessage: AgentMessage | undefined;

			while (
				this.config.maxIterations === undefined ||
				this.state.iteration < this.config.maxIterations
			) {
				this.throwIfAborted();

				this.state.iteration += 1;
				await this.emit({
					type: "turn-started",
					snapshot: this.snapshot(),
					iteration: this.state.iteration,
				});

				const { message, finishReason } =
					await this.generateAssistantMessageWithOverflowRecovery();
				if (finishReason === "aborted") {
					throw this.normalizeAbortError();
				}
				if (message.content.length === 0) {
					throw new Error(
						finishReason === "error"
							? (this.state.lastError ?? "Model stream failed")
							: "Model returned empty response",
					);
				}
				const toolCalls = message.content.filter(
					(part: AgentMessagePart): part is AgentToolCallPart =>
						part.type === "tool-call",
				);

				finalAssistantMessage = message;
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

				if (finishReason === "max-tokens" && toolCalls.length === 0) {
					throw new Error(MAX_TOKENS_INCOMPLETE_TURN_MESSAGE);
				}
				if (finishReason === "error" && toolCalls.length === 0) {
					throw new Error(this.state.lastError ?? "Model stream failed");
				}
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
					await this.emit({
						type: "message-added",
						snapshot: this.snapshot(),
						message: toolMessage,
					});
				}
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

	private async callBeforeRunHooks(): Promise<void> {
		for (const hook of this.hooks.beforeRun) {
			const control = (await hook({
				snapshot: this.snapshot(),
			})) as AgentStopControl | undefined;
			this.applyStopControl(control);
		}
	}

	private async callAfterRunHooks(result: AgentRunResult): Promise<void> {
		for (const hook of this.hooks.afterRun) {
			await hook({ snapshot: this.snapshot(), result });
		}
	}

	/**
	 * Run a model turn, recovering once per run from a provider-rejected
	 * context-window overflow: force a compaction through `prepareTurn` and
	 * retry the request. Terminal (unrecoverable) overflow states throw with
	 * an actionable message instead of the raw provider error.
	 */
	private async generateAssistantMessageWithOverflowRecovery(): Promise<{
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
	}> {
		const first = await this.generateAssistantMessage();
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

	private async generateAssistantMessage(options?: {
		overflowRecovery?: boolean;
	}): Promise<{
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
	}> {
		const usageBeforeModel = cloneUsage(this.state.usage);
		const modelRequestMetadata = omitUndefinedValues({
			sessionId: trimNonEmpty(this.config.sessionId),
			agentId: this.state.agentId,
			conversationId: trimNonEmpty(this.config.conversationId),
			runId: this.state.runId,
			iteration: this.state.iteration,
		});
		let request: AgentModelRequest = {
			systemPrompt: this.config.systemPrompt,
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
			}),
		};

		const taskLifecycleStartedAt = Date.now();
		const getTaskLifecycleDurationMs = () =>
			Date.now() - taskLifecycleStartedAt;

		if (this.state.iteration > 1) {
			const pendingUserMessage = await this.consumePendingUserMessage();
			if (pendingUserMessage) {
				request = {
					...request,
					messages: [
						...request.messages,
						...cloneMessages([pendingUserMessage]),
					],
				};
			}
		}

		request = await this.prepareTurnForModelRequest(request, options);
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

		this.throwIfAborted();
		this.captureTaskLifecycle(TASK_PROVIDER_REQUEST_STARTED_EVENT, {
			durationMs: getTaskLifecycleDurationMs(),
			phase: "provider_request_started",
		});
		const stream = this.openTaskLifecycleStream(
			request,
			getTaskLifecycleDurationMs,
		);

		const content: AgentMessagePart[] = [];
		const toolAssemblies = new Map<string, PendingToolAssembly>();
		const modelToolActivities = new Map<string, AgentModelToolActivity>();
		const invalidToolCalls: InvalidToolCall[] = [];
		const sequence: Array<
			{ type: "tool"; key: string } | { type: "part"; part: AgentMessagePart }
		> = [];
		let nextToolIndex = 0;
		let finishReason: AgentModelFinishReason = "stop";
		let accumulatedText = "";
		let accumulatedReasoning = "";

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
		const streamBefore = this.buildExecutionProjection();
		this.state.executionModelStreaming = true;
		await this.emitExecutionStateChangeIfChanged(streamBefore);
		try {
		for await (const event of stream) {
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
				case "reasoning-delta": {
					accumulatedReasoning += event.text;
					const last = sequence.at(-1);
					if (last?.type === "part" && last.part.type === "reasoning") {
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
				case "file": {
					// Model-generated file output. Preserved into the assistant
					// message so a file-only turn is not treated as empty:
					// images become image parts (the shape providers accept on
					// resend); other media becomes a file part carrying the
					// base64 payload.
					sequence.push({
						type: "part",
						part: event.mediaType.startsWith("image/")
							? {
									type: "image",
									image: event.data,
									mediaType: event.mediaType,
								}
							: {
									type: "file",
									path: `model-generated-file-${sequence.length + 1}`,
									content: event.data,
								},
					});
					break;
				}
				case "usage": {
					await this.updateUsage(event.usage);
					break;
				}
				case "finish": {
					finishReason = event.reason;
					if (event.error) {
						this.state.lastError = event.error;
						// Models that classify at their own error boundary (where the
						// raw provider error is still structured) win. Anything else —
						// custom `AgentModel` implementations, adapters that carry only
						// a flattened message — is classified from the message so it
						// stays eligible for overflow recovery.
						this.state.lastErrorClass =
							event.errorClass ?? classifyProviderError(event.error);
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

		for (const item of sequence) {
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
			})) as AgentStopControl | undefined;
			this.applyStopControl(control);
		}

		return { message, finishReason };
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
			stream = await this.config.model.stream(request);
			this.throwIfAborted();
			phase = "provider_stream_started";
			this.captureTaskLifecycle(TASK_PROVIDER_STREAM_STARTED_EVENT, {
				durationMs: getTaskLifecycleDurationMs(),
				phase,
			});
		} catch (error) {
			if (!this.isAbortError(error)) {
				this.captureTaskLifecycleFailure(
					error,
					phase,
					getTaskLifecycleDurationMs(),
				);
			}
			throw error;
		}

		let receivedFirstChunk = false;
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
				yield event;
			}
		} catch (error) {
			if (!this.isAbortError(error)) {
				this.captureTaskLifecycleFailure(
					error,
					phase,
					getTaskLifecycleDurationMs(),
				);
			}
			throw error;
		}
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

	private isAbortError(error: unknown): boolean {
		return (
			error instanceof AgentRuntimeAbortError ||
			this.abortController?.signal.aborted === true
		);
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
		options?: { overflowRecovery?: boolean },
	): Promise<AgentModelRequest> {
		if (!this.config.prepareTurn) {
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
			emitStatusNotice: (message, metadata) => {
				void this.emit({
					type: "status-notice",
					snapshot: this.snapshot(),
					message,
					metadata,
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
			return request;
		}

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
		const prepared: PreparedToolExecution[] = [];
		for (const toolCall of toolCalls) {
			prepared.push(await this.prepareToolExecution(toolCall));
		}

		if (this.config.toolExecution === "parallel") {
			// C1.4: capture the second-stage state at batch
			// START, before any sibling tool has run. After
			// the parallel batch resolves, re-check the
			// invariant using the SAME typed-outcome
			// authority as the sequential recovery path:
			// if state was `armed` at batch start AND any
			// sibling resolved with a typed
			// `failure` outcome (per the C1.1
			// `ToolRuntimeOutcome` authority model — NOT
			// the coarse `AgentToolResult.isError` flag),
			// the latch MUST fire to `terminating`. This
			// protects against non-deterministic completion
			// order: a sibling success applied first could
			// otherwise reset the latch to idle, masking
			// the genuine non-convergent failure that
			// follows. The tests
			// C14_REAL_PARALLEL_OK_FIRST and
			// C14_REAL_PARALLEL_FAIL_FIRST pin this.
			//
			// CRITICAL: authority model. The previous round
			// of this guard used
			// `AgentToolResult.isError === true` as the
			// recovery-failure predicate. That re-
			// introduced the C1.1 anti-pattern: `isError`
			// structurally conflates
			// `failure / recoverable` with
			// `control_plane / host_policy_denied |
			// user_rejected | runtime_skipped |
			// runtime_aborted`. A host-policy DENY of one
			// sibling in a parallel batch must NEVER arm
			// the second-stage continuation — that would
			// violate the C1.4 control-plane-exclusion
			// contract. The fix routes the guard through
			// the private runtime-owned
			// `pendingBatchOutcomes: ToolRuntimeOutcome[]`
			// buffer, populated by `executePreparedTool`
			// immediately after
			// `classifyToolRuntimeOutcome` produces the
			// typed outcome. The public
			// `onToolRuntimeOutcome` observation hook is
			// not the control plane — it is observer-only
			// and never feeds aggregation.
			const batchStartKind = this.recoverySecondStage.kind;
			// C1.5: capture the canonical projection at the batch
			// boundary and suspend per-tool emission for the duration of
			// the batch. Per-tool mutations inside `Promise.all` are
			// provisional — reconciliation below may overturn them — so
			// emitting them would make the public event sequence depend
			// on completion order.
			const recoveryBatchBefore = this.snapshotRecoveryState();
			this.recoveryEmissionSuspended = true;
			// Reset the per-batch buffer at the start of
			// each parallel invocation. The buffer is
			// runtime-owned and never visible externally.
			this.pendingBatchOutcomes.length = 0;
			let results: AgentMessage[];
			try {
				results = await Promise.all(
					prepared.map((execution) => this.executePreparedTool(execution)),
				);
				if (
					batchStartKind === "armed" &&
					this.recoverySecondStage.kind !== "terminating" &&
					this.batchContainsTypedFailure(this.pendingBatchOutcomes)
				) {
					// The trigger may have been cleared by an
					// earlier sibling success's applyPost (which
					// transitions armed → idle and discards the
					// trigger). The batch-level decision is
					// dominant: we set the trigger to
					// `episode_exhausted` because the underlying
					// arming cause was an episode-level non-
					// convergence. (Other triggers are possible
					// but episode_exhausted is the most general
					// one; the C14_REAL_PARALLEL_OK_FIRST test
					// pins this choice.)
					this.recoverySecondStage = {
						kind: "terminating",
						trigger: "episode_exhausted",
					};
					this.state.lastError = "bounded_recovery_exhausted";
				}
			} finally {
				// C1.5 / C1.6 residue: clear the private typed-outcome
				// buffer and lift the emission guard even when a tool
				// executor, hook, or abort throws out of the batch.
				// Without this, a throwing batch would leave
				// `recoveryEmissionSuspended === true` and silence every
				// subsequent recovery event for the run, and would leak
				// stale outcomes into the next batch's reconciliation.
				this.pendingBatchOutcomes.length = 0;
				this.recoveryEmissionSuspended = false;
			}
			// C1.5 PARALLEL EVENT ATOMICITY: exactly one canonical
			// recovery event for the whole batch, describing the
			// reconciled batch-level truth. FAIL_FIRST and OK_FIRST
			// therefore produce identical public sequences.
			await this.emitRecoveryStateChangeIfChanged(recoveryBatchBefore);
			return results;
		}

		const results: AgentMessage[] = [];
		for (const execution of prepared) {
			results.push(await this.executePreparedTool(execution));
		}
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
			} else if (policy.autoApprove === false) {
				const approval = await this.requestToolApproval(
					toolCall,
					input,
					policy,
				);
				if (!approval.approved) {
					// C1.2: classify the reason structurally. Host DENY
					// wins over user reject per CORRECTION04 invariant.
					controlPlaneOutcome = selectControlPlaneOutcome({
						hostDenied: approval.decision?.kind === "deny",
						userRejected: true,
					});
					skipReason =
						approval.reason ?? `Tool "${toolCall.toolName}" was not approved`;
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
			}
		}

		return {
			toolCall: { ...toolCall, input },
			tool,
			input,
			skipReason,
			controlPlaneOutcome,
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
					metadata: this.config.toolContextMetadata,
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
				this.applyStopControl(after);
				if (after?.result) {
					result = after.result;
				}
			}
		}

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
			case "tool-updated":
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
			event.type === "execution-state-changed";
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
