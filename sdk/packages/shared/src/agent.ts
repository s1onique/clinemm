/**
 * AgentRuntime contract types (ported from clinee `@cline/shared`).
 *
 * These are the canonical type definitions consumed by `AgentRuntime`.
 *
 */

import type {
	AgentRuntimeRecoverySnapshot,
	ToolRuntimeOutcome,
} from "./agents/recovery/types";
import type { ModelInfo } from "./llms/model-info";
import type {
	CommandExecutionPlan,
	InternalExecutionCapability,
	ToolApprovalRequest,
	ToolApprovalResult,
	ToolCallExecutionCapability,
	ToolPolicy,
} from "./llms/tools";
import type { BasicLogger } from "./logging/logger";
import type { ITelemetryService } from "./services/telemetry";

// =============================================================================
// Lightweight telemetry surface used by AgentRuntime
// =============================================================================

// =============================================================================
// Message parts
// =============================================================================

export interface AgentTextPart {
	type: "text";
	text: string;
}

export interface AgentReasoningPart {
	type: "reasoning";
	text: string;
	redacted?: boolean;
	metadata?: unknown;
}

export interface AgentImagePart {
	type: "image";
	image: string | Uint8Array | ArrayBuffer | URL;
	mediaType?: string;
}

export interface AgentFilePart {
	type: "file";
	path: string;
	content: string;
}

export interface AgentToolCallPart {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	input: unknown;
	metadata?: unknown;
	/** Absent for ordinary AgentRuntime-executed tools. */
	execution?: ModelToolExecution;
}

export interface AgentToolResultPart {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	output: unknown;
	isError?: boolean;
	/** Absent for ordinary AgentRuntime-executed tools. */
	execution?: ModelToolExecution;
}

export type ModelToolExecution = "client" | "provider";

/** Observational record for a model tool executed outside AgentRuntime. */
export interface AgentModelToolActivity {
	toolCallId: string;
	toolName: string;
	execution: ModelToolExecution;
	input?: unknown;
	output?: unknown;
	isError?: boolean;
}

export type AgentMessagePart =
	| AgentTextPart
	| AgentReasoningPart
	| AgentImagePart
	| AgentFilePart
	| AgentToolCallPart
	| AgentToolResultPart;

// =============================================================================
// Messages and token usage
// =============================================================================

export type AgentMessageRole = "user" | "assistant" | "tool";

export interface AgentTokenUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** Provider-reported hidden reasoning tokens, when available. */
	reasoningTokenCount?: number;
}

/**
 * Canonical `AgentUsage` shape for the new runtime.
 *
 * This supersedes the legacy `AgentUsage` (now `LegacyAgentUsage` in
 * `./agents/types`). The old, host-facing shape is
 * retained for `AgentResult`/`AgentUsageEvent` consumers via the facade.
 */
export interface AgentUsage extends AgentTokenUsage {
	totalCost?: number;
}

export interface AgentMessage {
	id: string;
	role: AgentMessageRole;
	content: AgentMessagePart[];
	createdAt: number;
	metadata?: Record<string, unknown>;
	modelInfo?: {
		id: string;
		provider: string;
		family?: string;
	};
	metrics?: AgentTokenUsage & {
		cost?: number;
	};
}

// =============================================================================
// Runtime state
// =============================================================================

export type AgentRole = string;

export type AgentRunStatus =
	| "idle"
	| "running"
	| "completed"
	| "aborted"
	| "failed";

/**
 * RSMT01 RUN-LIFECYCLE EXECUTION STATE.
 *
 * The orthogonal activity/interaction projection that lives
 * alongside `status: AgentRunStatus`. Lifecycle is the run
 * phase (`idle` / `running` / `completed` / `aborted` /
 * `failed`); this object captures the CURRENT progress markers
 * a host or UI needs to render truthful task state:
 *
 *   - `modelStreaming` is true while the runtime is
 *     inside `model.stream(...)` actively consuming
 *     chunks. False during preparation, after the stream
 *     settles, or between turns.
 *   - `tooling` follows the BROAD (Option A) semantics:
 *     it is true whenever the runtime currently owns one
 *     or more unresolved tool calls, regardless of
 *     which sub-phase those calls are in. This includes
 *     tool calls that are:
 *       - parsed and pending approval,
 *       - queued in a parallel batch (waiting for
 *         siblings),
 *       - denied before execution (skipReason set), or
 *       - actively inside `tool.execute(...)`.
 *     Source: `state.pendingToolCalls.length > 0`. It is
 *     intentionally NOT a "is the executor currently
 *     running" signal — the latter would require
 *     additional per-batch executor-count state that
 *     this ACT does not introduce.
 *     Therefore during a host DENY or while waiting for
 *     an approval decision, `tooling` may be true
 *     together with `awaitingApproval` — this is the
 *     intentionally documented overlap, pinned by
 *     RSM-CORRECTION02.
 *   - `awaitingApproval` is true ONLY while
 *     `requestToolApproval(...)` is in flight. Cleared
 *     the moment the decision (approved / denied /
 *     rejected) is observed. Host DENY is a completed
 *     control decision, NOT an "awaiting user" state.
 *
 * INVARIANTS (frozen by RSMT01 and pinned by
 * `agent-runtime.execution-state.test.ts`):
 *
 *   I1: terminal lifecycle => modelStreaming=false,
 *       tooling=false, awaitingApproval=false.
 *   I2: awaitingApproval=true => status === "running".
 *   I3: no active run => all three boolean flags false.
 *   I4: every emitted event payload carries
 *       `event.snapshot.execution` BY CONSTRUCTION —
 *       the snapshot is built once per event by
 *       `AgentRuntime.snapshot()`.
 *   I5: `restore()` (or `run()` re-entry) => all three
 *       flags cleared. Prior activity cannot leak.
 *   I6: `recovery` is a separate orthogonal projection;
 *       this object does NOT add a `recovering` field.
 *       (See `C1.5 / snapshot.recovery` for the recovery
 *       surface.)
 *
 * CONSUMER RULE: UI and host layers MUST read from
 * `snapshot.execution` and `snapshot.status`. They MUST
 * NOT derive task state from message prose
 * (`lastMessage.partial === true`,
 * `lastMessage.say === "api_req_started"`,
 * conversation history parsing, button visibility, or
 * pending prompt state). The previous
 * prose-derived inference is the upstream bug class
 * this projection is designed to prevent.
 */
export interface AgentRuntimeExecutionState {
	modelStreaming: boolean;
	tooling: boolean;
	awaitingApproval: boolean;
}

/**
 * C1.5 LIVE-RUNTIME REFINEMENT.
 *
 * `AgentRuntimeStateSnapshot` keeps `recovery?` so pre-C1.5 hand-built
 * fixtures stay valid without rewriting unrelated literals. But every
 * snapshot a live runtime produces — including every event payload it
 * emits — is structurally required to carry the canonical projection.
 * Consumers reading from a real runtime can therefore treat the field
 * as non-optional without an `undefined` check.
 *
 * P1 EXPRESSION: intersect the base types with a non-optional
 * `recovery` wherever the guarantee actually holds. `AgentRuntime`
 * exposes both refinements through its public subscribe/snapshot
 * surface (see `agent-runtime.ts`); hand-built test stubs that
 * construct bare events retain the base types so legacy fixtures do
 * not have to migrate.
 */
export type LiveAgentRuntimeStateSnapshot = AgentRuntimeStateSnapshot & {
	recovery: AgentRuntimeRecoverySnapshot;
	execution: AgentRuntimeExecutionState;
};

/**
 * Every variant of the runtime event union with its `snapshot` field
 * narrowed to `LiveAgentRuntimeStateSnapshot`. A real
 * `AgentRuntime.subscribe()` callback receives this shape, so
 * `event.snapshot.recovery` is non-optional at the consumer's call
 * site — without requiring hand-built test fixtures to add the field.
 */
export type LiveAgentRuntimeEvent = {
	[K in AgentRuntimeEvent["type"]]: Extract<
		AgentRuntimeEvent,
		{ type: K }
	> extends infer Variant
		? Variant extends { snapshot: AgentRuntimeStateSnapshot }
			? Omit<Variant, "snapshot"> & {
					snapshot: LiveAgentRuntimeStateSnapshot;
				}
			: Variant
		: never;
}[AgentRuntimeEvent["type"]];

export interface AgentRuntimeStateSnapshot {
	agentId: string;
	agentRole?: AgentRole;
	parentAgentId?: string | null;
	conversationId?: string;
	runId?: string;
	status: AgentRunStatus;
	iteration: number;
	messages: readonly AgentMessage[];
	pendingToolCalls: readonly string[];
	usage: AgentUsage;
	lastError?: string;
	/** Classification of `lastError` when it came from a provider stream. */
	lastErrorClass?: ProviderErrorClass;
	/**
	 * C1.5 CANONICAL RECOVERY TRUTH.
	 *
	 * The bounded-recovery projection that governs the runtime's NEXT
	 * control decision. Because every `AgentRuntimeEvent` variant embeds
	 * this same `AgentRuntimeStateSnapshot` — produced by the one
	 * `AgentRuntime.snapshot()` call — the event payload and
	 * `runtime.snapshot().recovery` are the SAME value by construction.
	 * There is no second authority that could drift.
	 *
	 * Consumers MUST read recovery state from here, never by parsing
	 * conversation history, tool-result prose, or approval UI state.
	 *
	 * OPTIONALITY: `AgentRuntime.snapshot()` ALWAYS populates this field,
	 * so every snapshot and every event emitted by a real runtime carries
	 * it (pinned by `C15_EVENT_EQUALS_SNAPSHOT`). The field is optional
	 * only so that hand-built partial snapshots — test fixtures and
	 * synthetic host stubs that predate C1.5 — remain valid without
	 * rewriting dozens of unrelated literals. Treat a missing value as
	 * "this snapshot did not come from a runtime", never as "recovery is
	 * idle".
	 */
	recovery?: AgentRuntimeRecoverySnapshot;
	/**
	 * RSMT01 CANONICAL EXECUTION TRUTH.
	 *
	 * The activity/interaction projection. Mirrors the
	 * `recovery?` optionality contract: every snapshot a live
	 * runtime produces carries this field (pinned by
	 * `RSMT01_EVENT_EQUALS_SNAPSHOT`). A missing value
	 * means the snapshot did not come from a runtime —
	 * never "execution is idle".
	 *
	 * See `AgentRuntimeExecutionState` for the invariant
	 * contract and the consumer rule.
	 */
	execution?: AgentRuntimeExecutionState;
}

// =============================================================================
// Tools
// =============================================================================

export interface AgentToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	lifecycle?: {
		/**
		 * Whether a successful call to this tool completes the current run.
		 */
		completesRun?: boolean;
	};
}

export interface AgentToolResult<TOutput = unknown> {
	output: TOutput;
	isError?: boolean;
	metadata?: Record<string, unknown>;
}

export interface AgentToolContext {
	sessionId?: string;
	agentId: string;
	conversationId?: string;
	runId?: string;
	iteration: number;
	toolCallId?: string;
	signal?: AbortSignal;
	metadata?: Record<string, unknown>;
	/**
	 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
	 * C2 plumbing (CORRECTION01 of C1):
	 *
	 * CLOSED runtime-owned authority slot. Populated by the runtime
	 * from the host's policy callback result
	 * (`ToolApprovalResult.executionCapability`), NEVER from
	 * `toolCall.metadata`. Untrusted sources cannot reach this slot.
	 *
	 * Provenance (frozen in metadata-provenance.md):
	 *   Source 1 (model-stream metadata): NOT used.
	 *   Source 2 (runtime-owned keys):   NOT used.
	 *   Source 3 (host-attached; trusted IF typed slot): IS used,
	 *     via ToolApprovalResult.executionCapability -> this slot.
	 *
	 * Type-level narrowing: `InternalExecutionCapability` is a closed
	 * union with literal `kind` discriminator; widening it requires
	 * editing this file (not metadata). Tools MUST switch on `kind`
	 * to consume the slot.
	 *
	 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2 GUARD:
	 * This field is typed as `ToolCallExecutionCapability` (a leaf
	 * of `InternalExecutionCapability` containing only
	 * `factory-binding-probe`). Real authority-bearing variants are
	 * NOT reachable through this field at compile time. Real
	 * authority flows via the per-command channel
	 * (`commandExecutionPlan` slot below).
	 */
	executionCapability?: ToolCallExecutionCapability;
	/**
	 * ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01:
	 *
	 * CLOSED runtime-owned per-command plan slot. Populated by the
	 * runtime from `ToolApprovalResult.executionPlan` (the host's
	 * authorization envelope). The plan carries per-entry authority
	 * (`CommandExecutionPlanEntry.executionCapability`) that travels
	 * with the decision that granted it.
	 *
	 * Provenance (frozen in metadata-provenance.md):
	 *   Source 1 (model-stream metadata):    NOT used (typed slot).
	 *   Source 2 (runtime-owned keys):       NOT used (typed slot).
	 *   Source 3 (host-attached; trusted):   IS used, via
	 *     `ToolApprovalResult.executionPlan` -> this slot.
	 *
	 * NEVER copied from `toolCall.metadata`. NEVER a parallel
	 * `perCommandExecutionCapabilities[]` array. The plan is the
	 * authority-bearing structure; the executor must consume it by
	 * `commandIndex` (positional) and FAIL CLOSED if correlation
	 * cannot be proven exactly (cardinality drift, reorder,
	 * invalid indices, unsupported shapes).
	 *
	 * When this slot is present, the executor MUST use
	 * `entry.executionCapability` (or undefined) and MUST NOT fall
	 * back to the tool-call `AgentToolContext.executionCapability`.
	 * When this slot is absent, the legacy tool-call capability
	 * path is allowed (synthetic transport compatibility only).
	 */
	commandExecutionPlan?: CommandExecutionPlan;
	/**
	 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2-CORRECTION01:
	 *
	 * Typed per-command authority channel -- the ONLY field that may
	 * carry a real authority-bearing capability
	 * (`filesystem-create-only`, ...) through the executor boundary
	 * WITHOUT an assertion cast.
	 *
	 * Why a separate field? The reviewer of the prior GUARD commit
	 * observed that putting the full `InternalExecutionCapability`
	 * union into `AgentToolContext.executionCapability` (which is
	 * narrowed to `ToolCallExecutionCapability`) would force an
	 * `as AgentToolContext` cast at the executor boundary --
	 * defeating the compile-time type split at the exact authority-
	 * bearing seam.
	 *
	 * This field is the type-safe counterpart:
	 *   `executionCapability`              -> factory-binding-probe only
	 *   `perCommandExecutionCapability`   -> full InternalExecutionCapability
	 *
	 * Stamped by the executor ONLY when a per-command plan exists
	 * and the plan entry carries a capability. NEVER stamped by the
	 * runtime or by the host; this is the executor's typed output.
	 *
	 * Channel separation at the type system:
	 *   no plan + factory probe      -> executionCapability = probe,
	 *                                    perCommandExecutionCapability = undefined
	 *   valid plan [fs, none]        -> executionCapability = undefined,
	 *                                    perCommandExecutionCapability[0] = fs,
	 *                                    perCommandExecutionCapability[1] = undefined
	 *
	 * Downstream consumers (`CommandJobManager.start`,
	 * `CommandJob.executionCapability`, Seatbelt profile generator)
	 * MUST read `context.perCommandExecutionCapability` and MUST NOT
	 * widen `executionCapability` at the call site. The legacy
	 * `executionCapability` field remains for synthetic transport
	 * compatibility (factory-binding-probe only).
	 *
	 * The runtime guard at the executor boundary
	 * (`real_execution_capability_requires_per_command_plan`) remains
	 * unchanged: TypeScript alone is not a runtime security boundary.
	 */
	perCommandExecutionCapability?: InternalExecutionCapability;
	snapshot?: AgentRuntimeStateSnapshot;
	emitUpdate?: (update: unknown) => void;
}

export interface AgentTool<TInput = unknown, TOutput = unknown>
	extends AgentToolDefinition {
	timeoutMs?: number;
	retryable?: boolean;
	maxRetries?: number;
	execute: (
		input: TInput,
		context: AgentToolContext,
	) => Promise<TOutput> | TOutput;
	/**
	 * Optional runtime input validator. Invoked by AgentRuntime
	 * BEFORE `requestToolApproval`. If it throws or returns a non-empty
	 * string, the runtime routes the call through the input-parse-error
	 * path (no approval, no executor, classifier Priority 3 =
	 * `failure / tool_input_invalid`).
	 *
	 * ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01 contract: malformed
	 * model tool calls must NEVER reach approval or execution.
	 *
	 * Authoring tools via `createTool({ inputSchema: zodSchema })`
	 * auto-generates this from the Zod schema; tools that supply a raw
	 * JSON schema may set it explicitly.
	 */
	validateInput?: (input: unknown) => void | string | Promise<void | string>;
}

// =============================================================================
// Model adapter contract
// =============================================================================

export interface AgentModelRequest {
	systemPrompt?: string;
	messages: readonly AgentMessage[];
	tools: readonly AgentToolDefinition[];
	/** Provider-executed tools enabled for this model request. */
	modelTools?: readonly import("./llms/model-tools").ModelTool[];
	signal?: AbortSignal;
	options?: Record<string, unknown>;
}

export interface AgentRuntimePrepareTurnContext {
	agentId: string;
	conversationId?: string;
	parentAgentId?: string | null;
	iteration: number;
	messages: readonly AgentMessage[];
	systemPrompt?: string;
	tools: readonly AgentToolDefinition[];
	model: {
		id?: string;
		provider?: string;
		info?: ModelInfo;
	};
	signal?: AbortSignal;
	/**
	 * Set when the previous model request was rejected as exceeding the
	 * model's context window; asks the prepare-turn pipeline to force a
	 * compaction rather than trust its token estimates.
	 */
	overflowRecovery?: boolean;
	emitStatusNotice?: (
		message: string,
		metadata?: Record<string, unknown>,
	) => void;
}

export interface AgentRuntimePrepareTurnResult {
	messages?: readonly AgentMessage[];
	systemPrompt?: string;
}

export type AgentModelFinishReason =
	| "stop"
	| "tool-calls"
	| "max-tokens"
	| "aborted"
	| "error";

/**
 * Coarse classification of a provider error, derived from the raw provider
 * error object before it is flattened into a display string. Shared by the
 * runtime's recovery policy and telemetry (`error_class`). Extend with new
 * classes (auth, rate_limit, billing, ...) as consumers need them.
 */
export type ProviderErrorClass = "context_window_exceeded" | "unknown";

export type AgentModelEvent =
	| { type: "text-delta"; text: string }
	| {
			type: "reasoning-delta";
			text: string;
			redacted?: boolean;
			metadata?: unknown;
	  }
	| {
			type: "tool-call-delta";
			index?: number;
			toolCallId?: string;
			toolName?: string;
			inputText?: string;
			input?: unknown;
			metadata?: unknown;
			/** Set when execution is owned by AI SDK or the model provider. */
			execution?: ModelToolExecution;
	  }
	| {
			type: "tool-result";
			toolCallId: string;
			toolName: import("./llms/model-tools").ModelToolName;
			input?: unknown;
			output: unknown;
			isError?: boolean;
			execution: ModelToolExecution;
	  }
	| {
			/**
			 * A model-generated file (e.g. an image from an image-output
			 * model). `data` is base64-encoded file data (or a URL for
			 * URL-referenced files). Runtimes assemble it into the assistant
			 * message (`AgentImagePart` for `image/*`, `AgentFilePart`
			 * otherwise) so a file-only turn is not treated as empty.
			 */
			type: "file";
			data: string;
			mediaType: string;
	  }
	| {
			type: "usage";
			usage: Partial<AgentUsage>;
	  }
	| {
			type: "finish";
			reason: AgentModelFinishReason;
			error?: string;
			errorClass?: ProviderErrorClass;
			/**
			 * The model layer already recorded `sdk.error` telemetry for this
			 * failure at its own error boundary. `error` is a flattened string,
			 * so this bit carries reporting ownership across the boundary: the
			 * agent loop skips re-reporting when it is set, and still reports
			 * failures from model implementations that do not record their own
			 * telemetry.
			 */
			errorReported?: boolean;
	  };

export interface AgentModel {
	stream: (
		request: AgentModelRequest,
	) => AsyncIterable<AgentModelEvent> | Promise<AsyncIterable<AgentModelEvent>>;
}

// =============================================================================
// Hook contexts
// =============================================================================

export interface AgentBeforeModelContext {
	snapshot: AgentRuntimeStateSnapshot;
	request: AgentModelRequest;
}

export interface AgentStopControl {
	stop?: boolean;
	reason?: string;
}

export interface AgentBeforeModelResult {
	stop?: boolean;
	reason?: string;
	messages?: readonly AgentMessage[];
	tools?: readonly AgentToolDefinition[];
	options?: Record<string, unknown>;
}

export interface AgentAfterModelContext {
	snapshot: AgentRuntimeStateSnapshot;
	assistantMessage: AgentMessage;
	finishReason: AgentModelFinishReason;
}

export interface AgentBeforeToolContext {
	snapshot: AgentRuntimeStateSnapshot;
	tool: AgentTool;
	toolCall: AgentToolCallPart;
	input: unknown;
}

export interface AgentBeforeToolResult {
	skip?: boolean;
	stop?: boolean;
	reason?: string;
	input?: unknown;
	policy?: ToolPolicy;
}

export interface AgentAfterToolContext {
	snapshot: AgentRuntimeStateSnapshot;
	tool: AgentTool;
	toolCall: AgentToolCallPart;
	input: unknown;
	result: AgentToolResult;
	startedAt: Date;
	endedAt: Date;
	durationMs: number;
}

export interface AgentAfterToolResult {
	stop?: boolean;
	reason?: string;
	result?: AgentToolResult;
}

/**
 * C1.2 observable seam: the production `ToolRuntimeOutcome` that
 * `AgentRuntime.executePreparedTool` produced for a single tool call.
 *
 * This is the hook that proves the runtime wiring closed. The integration
 * tests assert against the captured value here — NOT by replaying the
 * classifier themselves.
 *
 * Intentionally narrow:
 *   - Read-only observation. The hook does NOT take a return value,
 *     does NOT mutate `outcome`, and does NOT route to RecoveryTracker.
 *   - Per-call local. C1.2 deliberately does not aggregate across calls.
 *   - No telemetry, no UI, no persistence surface introduced here.
 *
 * Future ACTs may route this outcome through RecoveryTracker / telemetry
 * by adding a NEW hook or by consuming this hook from a higher layer —
 * not by changing the signature of this observation hook.
 */
export interface AgentToolRuntimeOutcomeHookContext {
	toolCall: AgentToolCallPart;
	outcome: ToolRuntimeOutcome;
}

export interface AgentRunLifecycleContext {
	snapshot: AgentRuntimeStateSnapshot;
}

// =============================================================================
// Runtime hook bag
// =============================================================================

/**
 * 8-callback hook bag consumed by `AgentRuntime`.
 */
export interface AgentRuntimeHooks {
	beforeRun?: (
		context: AgentRunLifecycleContext,
	) => AgentStopControl | undefined | Promise<AgentStopControl | undefined>;
	afterRun?: (
		context: AgentRunLifecycleContext & { result: AgentRunResult },
	) => void | Promise<void>;
	beforeModel?: (
		context: AgentBeforeModelContext,
	) =>
		| AgentBeforeModelResult
		| undefined
		| Promise<AgentBeforeModelResult | undefined>;
	afterModel?: (
		context: AgentAfterModelContext,
	) => AgentStopControl | undefined | Promise<AgentStopControl | undefined>;
	beforeTool?: (
		context: AgentBeforeToolContext,
	) =>
		| AgentBeforeToolResult
		| undefined
		| Promise<AgentBeforeToolResult | undefined>;
	afterTool?: (
		context: AgentAfterToolContext,
	) =>
		| AgentAfterToolResult
		| undefined
		| Promise<AgentAfterToolResult | undefined>;
	/**
	 * C1.2 observable seam. Fires once per tool call after the runtime
	 * has produced a `ToolRuntimeOutcome` for that call. Read-only
	 * observation; not a control plane. See
	 * `AgentToolRuntimeOutcomeHookContext`.
	 */
	onToolRuntimeOutcome?: (
		context: AgentToolRuntimeOutcomeHookContext,
	) => void | Promise<void>;
	onEvent?: (event: AgentRuntimeEvent) => void | Promise<void>;
}

// =============================================================================
// Plugins
// =============================================================================

export interface AgentRuntimePluginContext {
	agentId: string;
	agentRole?: AgentRole;
	systemPrompt?: string;
}

export interface AgentRuntimePluginSetup {
	// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary per tool
	tools?: readonly AgentTool<any, any>[];
	hooks?: Partial<AgentRuntimeHooks>;
}

export interface AgentRuntimePlugin {
	name: string;
	setup?: (
		context: AgentRuntimePluginContext,
	) =>
		| AgentRuntimePluginSetup
		| undefined
		| Promise<AgentRuntimePluginSetup | undefined>;
}

// =============================================================================
// Runtime config
// =============================================================================

export interface AgentRuntimeConfig {
	/**
	 * Core/hub runtime session identifier.
	 *
	 * The host-owned lifecycle id for the task/session containing this runtime.
	 * It is stable for hub subscriptions, session persistence, abort/stop
	 * commands, and approval routing. It can differ from `conversationId`, which
	 * tracks the agent transcript.
	 */
	sessionId?: string;
	agentId?: string;
	/**
	 * Agent conversation/transcript identifier.
	 *
	 * Used by the stateless agent loop, tools, hooks, telemetry, and model
	 * history correlation. This id follows the current conversation store and
	 * should not be used as the hub/session routing key.
	 */
	conversationId?: string;
	parentAgentId?: string | null;
	agentRole?: AgentRole;
	systemPrompt?: string;
	messageModelInfo?: AgentMessage["modelInfo"];
	model: AgentModel;
	modelOptions?: Record<string, unknown>;
	/** Provider-executed tools, separate from locally executed AgentTools. */
	modelTools?: readonly import("./llms/model-tools").ModelTool[];
	// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary per tool
	tools?: readonly AgentTool<any, any>[];
	hooks?: Partial<AgentRuntimeHooks>;
	plugins?: readonly AgentRuntimePlugin[];
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	initialMessages?: readonly AgentMessage[];
	maxIterations?: number;
	completionPolicy?: {
		requireCompletionTool?: boolean;
		completionGuard?: () => string | undefined;
	};
	toolExecution?: "sequential" | "parallel";
	toolPolicies?: Record<string, ToolPolicy>;
	toolContextMetadata?: Record<string, unknown>;
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult> | ToolApprovalResult;
	/**
	 * Optional host-owned request projection hook invoked before each model call.
	 *
	 * Returned messages affect only the provider request for the current call.
	 * They do not replace the canonical runtime transcript, are not persisted as
	 * session history, and are not reflected in AgentRunResult.messages.
	 */
	prepareTurn?: (
		context: AgentRuntimePrepareTurnContext,
	) =>
		| Promise<AgentRuntimePrepareTurnResult | undefined>
		| AgentRuntimePrepareTurnResult
		| undefined;
	// Optional host callback used by interactive sessions to inject a queued
	// user steering message between agent loop iterations, before the next
	// model request.
	consumePendingUserMessage?: () =>
		| string
		| undefined
		| Promise<string | undefined>;
}

// =============================================================================
// Runtime event union
// =============================================================================

export type AgentRuntimeEvent =
	| {
			type: "run-started";
			snapshot: AgentRuntimeStateSnapshot;
	  }
	| {
			type: "message-added";
			snapshot: AgentRuntimeStateSnapshot;
			message: AgentMessage;
	  }
	| {
			type: "turn-started";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
	  }
	| {
			type: "assistant-text-delta";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			text: string;
			accumulatedText: string;
	  }
	| {
			type: "assistant-reasoning-delta";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			text: string;
			accumulatedText: string;
			redacted?: boolean;
			metadata?: unknown;
	  }
	| {
			type: "assistant-message";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			message: AgentMessage;
			finishReason: AgentModelFinishReason;
	  }
	| {
			type: "tool-started";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			toolCall: AgentToolCallPart;
	  }
	| {
			type: "tool-updated";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			toolCall: AgentToolCallPart;
			update: unknown;
	  }
	| {
			type: "tool-finished";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			toolCall: AgentToolCallPart;
			message: AgentMessage;
	  }
	| {
			type: "usage-updated";
			snapshot: AgentRuntimeStateSnapshot;
			usage: AgentUsage;
	  }
	| {
			type: "turn-finished";
			snapshot: AgentRuntimeStateSnapshot;
			iteration: number;
			toolCallCount: number;
	  }
	| {
			type: "status-notice";
			snapshot: AgentRuntimeStateSnapshot;
			message: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			type: "run-finished";
			snapshot: AgentRuntimeStateSnapshot;
			result: AgentRunResult;
	  }
	| {
			type: "run-failed";
			snapshot: AgentRuntimeStateSnapshot;
			error: Error;
			/** Classification of the provider error that failed the run. */
			errorClass?: ProviderErrorClass;
	  }
	/**
	 * C1.5 canonical recovery state change.
	 *
	 * Emitted when the externally-observable recovery projection changes.
	 * The authoritative payload is `snapshot.recovery` (identical to
	 * `runtime.snapshot().recovery` at emission time, by construction —
	 * both come from the same `snapshot()` call). `previousRecovery` is
	 * supplied for convenience so a consumer can render a transition
	 * without retaining its own copy of prior state; it is NEVER the
	 * source of truth.
	 *
	 * Ordering guarantees:
	 *   - Emitted AFTER the authoritative recovery mutation, so the
	 *     payload always describes the state that governs the next
	 *     control decision.
	 *   - For the terminal latch, emitted BEFORE the run's terminal
	 *     event, so a consumer never sees "aborted" before learning why.
	 *   - For parallel tool batches, emitted at the BATCH BOUNDARY only;
	 *     scheduler-dependent per-tool intermediates are suppressed.
	 */
	/**
	 * RSMT01 execution transition.
	 *
	 * Emitted when the externally-observable execution
	 * projection changes (any of `modelStreaming`,
	 * `tooling`, `awaitingApproval` flips).
	 * Authoritative payload is `snapshot.execution`.
	 * Mirrors the C1.5 `recovery-state-changed` design.
	 */
	| {
			type: "execution-state-changed";
			snapshot: AgentRuntimeStateSnapshot;
			/** Projection immediately before the authoritative mutation. */
			previousExecution: AgentRuntimeExecutionState;
	  }
	| {
			type: "recovery-state-changed";
			snapshot: AgentRuntimeStateSnapshot;
			/** Projection immediately before the authoritative mutation. */
			previousRecovery: AgentRuntimeRecoverySnapshot;
	  };

// =============================================================================
// Run result
// =============================================================================

export interface AgentRunResult {
	agentId: string;
	agentRole?: AgentRole;
	runId: string;
	status: Exclude<AgentRunStatus, "idle" | "running">;
	iterations: number;
	outputText: string;
	messages: readonly AgentMessage[];
	usage: AgentUsage;
	error?: Error;
}
