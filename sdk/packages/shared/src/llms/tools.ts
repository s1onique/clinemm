/**
 * Shared tool policy and execution record types.
 */

import { z } from "zod";

export interface ToolPolicy {
	/**
	 * Whether the tool can be executed at all.
	 * @default true
	 */
	enabled?: boolean;
	/**
	 * Whether this tool can run without asking the client for approval.
	 * @default true
	 */
	autoApprove?: boolean;
}

// =============================================================================
// Tool Call Record
// =============================================================================

/**
 * Record of a tool call execution
 */
export interface ToolCallRecord {
	/** Unique identifier for this tool call */
	id: string;
	/** Name of the tool that was called */
	name: string;
	/** Absent for ordinary AgentRuntime-executed tools. */
	execution?: "client" | "provider";
	/** Input passed to the tool */
	input: unknown;
	/** Output returned from the tool (if successful) */
	output: unknown;
	/** Error message (if the tool failed) */
	error?: string;
	/** Time taken to execute the tool in milliseconds */
	durationMs: number;
	/** Timestamp when the tool call started */
	startedAt: Date;
	/** Timestamp when the tool call ended */
	endedAt: Date;
}

export interface ToolApprovalRequest {
	/**
	 * Core/hub runtime session identifier.
	 *
	 * This is the routing and lifecycle id for the task/session that owns the
	 * tool call. Hosts and hub transports use it to deliver approval events to
	 * clients subscribed to that session and to correlate approval responses
	 * with the pending runtime session. It should not be used as the transcript
	 * id for model history.
	 */
	sessionId: string;
	/**
	 * Agent instance identifier.
	 *
	 * This identifies the lead or delegated agent that requested the tool call.
	 * It is used for attribution in approval prompts, events, telemetry, and
	 * team/sub-agent flows. It is not a hub routing key and should not be used
	 * to find the owning runtime session.
	 */
	agentId: string;
	/**
	 * Agent conversation/transcript identifier.
	 *
	 * This identifies the model conversation that produced the tool call. Tools,
	 * hooks, telemetry, and persisted session metadata use it to correlate work
	 * with the agent's message history. It is contextual data, not the hub event
	 * routing key.
	 */
	conversationId: string;
	iteration: number;
	toolCallId: string;
	toolName: string;
	input: unknown;
	policy: ToolPolicy;
}

/**
 * FactoryBindingProbeCapability -- the synthetic zero-authority
 * capability used by the binding seam proof.
 *
 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01.
 * Never authority-bearing; carries only a correlation identifier
 * for RED/GREEN tests. Permitted to flow through the legacy
 * tool-call channel (AgentToolContext.executionCapability,
 * ToolApprovalResult.executionCapability) because it has no
 * real-world authority to leak.
 */
export interface FactoryBindingProbeCapability {
	readonly kind: "factory-binding-probe"
	readonly correlationId: string
}

/**
 * FilesystemCreateOnlyCapability -- REAL authority-bearing variant.
 *
 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01:
 *
 * Grants create-only filesystem authority scoped to the listed
 * `roots`. This is the first real authority-bearing variant in
 * the union, which is why the C2 GUARD ACT enforces a strict
 * rule: real authority MUST travel on a per-command plan entry,
 * NEVER on the legacy tool-call channel.
 *
 * Kernel mapping (Darwin Seatbelt):
 *   roots[i] -> (allow file-write-create (subpath "<root>"))
 *
 * This is a CLOSED leaf. Widening requires adding a new union
 * member to `InternalExecutionCapability`.
 */
export interface FilesystemCreateOnlyCapability {
	readonly kind: "filesystem-create-only"
	readonly roots: ReadonlyArray<string>
}

/**
 * InternalExecutionCapability -- CLOSED runtime-owned authority slot.
 *
 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
 * C2 plumbing (CORRECTION01 of C1). The shape is a closed union
 * enumerated explicitly. The runtime owns the writer; nothing else
 * may populate it.
 *
 * IMPORTANT: this is NOT a generic metadata bag. The union has a
 * literal `kind` discriminator; untrusted model/tool metadata
 * CANNOT create an InternalExecutionCapability because the runtime
 * is the only writer and only constructs values of an explicit
 * variant from the host's policy callback.
 *
 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2 GUARD:
 * The legacy tool-call channel (`AgentToolContext.executionCapability`
 * and `ToolApprovalResult.executionCapability`) is typed as
 * `ToolCallExecutionCapability` (factory-binding-probe ONLY).
 * Real authority-bearing variants (`filesystem-create-only`, ...)
 * are reachable only via `CommandExecutionPlanEntry.executionCapability`
 * and only after per-command plan correlation succeeds.
 *
 * Provenance boundary (see metadata-provenance.md in the ACT):
 *   TRUSTED SOURCE:
 *     authorization/approval execution plan
 *       -> runtime-owned executionCapability (THIS TYPE)
 *   UNTRUSTED / NON-AUTHORITATIVE:
 *     prepared.toolCall.metadata
 *       -> MUST NEVER populate typed slot
 */
export type InternalExecutionCapability =
	| FactoryBindingProbeCapability
	| FilesystemCreateOnlyCapability

/**
 * ToolCallExecutionCapability -- the legacy tool-call channel union.
 *
 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2 GUARD:
 *
 * Compile-time guarantee that the legacy tool-call slot cannot
 * carry real authority. Only the synthetic factory-binding probe
 * is permitted here. Real authority-bearing variants MUST travel
 * on `CommandExecutionPlanEntry.executionCapability` (the
 * per-command channel).
 *
 * Why a separate type? TypeScript type narrowing is the structural
 * guarantee, but the runtime guard in
 * `executeShellCommands` (sdk/packages/core/src/extensions/tools/definitions.ts)
 * is the actual security boundary -- the runtime rejects any
 * tool-call capability whose `kind` is not `"factory-binding-probe"`
 * before fanout.
 */
export type ToolCallExecutionCapability = FactoryBindingProbeCapability

export interface ToolApprovalResult {
	approved: boolean;
	reason?: string;
	/**
	 * Optional runtime-owned authority slot stamped by the host's
	 * authorization callback. The runtime is the only writer; the
	 * value crosses the AgentToolContext.executionCapability seam
	 * into the executor as a TYPED SLOT, not via the generic
	 * metadata bag.
	 *
	 * ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01:
	 * provenance-classified (metadata-provenance.md). MUST be
	 * populated by the host's policy callback if and only if the
	 * callback intends to grant per-invocation authority. The
	 * runtime reads this field at the construction site
	 * (agent-runtime.ts) and typechecks the value; untrusted
	 * model/tool metadata CANNOT populate it.
	 *
	 * ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2 GUARD:
	 * This field is typed as `ToolCallExecutionCapability`
	 * (factory-binding-probe only). Real authority-bearing
	 * variants (`filesystem-create-only`, ...) are NOT reachable
	 * through this field at compile time. Hosts that need to grant
	 * real authority MUST do so via
	 * `executionPlan.commands[i].executionCapability`.
	 */
	executionCapability?: ToolCallExecutionCapability;
	/**
	 * Optional canonical decision from the host's command policy evaluator.
	 *
	 * When set, the coordinator MUST check `decision.kind` BEFORE
	 * consulting `approved`. Specifically:
	 *   - kind === "deny"  => return { approved: false }. Do NOT open
	 *                          an overridable approval UI. Nothing executes.
	 *   - kind === "ask"   => open the approval UI. On YES, re-emit
	 *                          the same decision object (or preserve the
	 *                          executionPlan). On NO, deny.
	 *   - kind === "allow" => auto-approve (handled via approved=true).
	 *
	 * This field is set exclusively by hosts that use the canonical
	 * command policy (evaluateCommandPolicy / evaluateCommandToolApproval).
	 * Hosts that use the legacy boolean path should omit it.
	 */
	decision?: {
		kind: "allow" | "ask" | "deny";
		reason: string;
		source: string;
	};
	/**
	 * Optional execution plan returned by the approval callback.
	 *
	 * When set, the AgentRuntime MUST replace the tool input used for
	 * execution with `executionPlan.transformedInput` before invoking the
	 * tool. The runtime MUST NOT silently fall back to the original
	 * (possibly unhardened) input. This is the structural enforcement
	 * point for CORRECTION04: the classifier produces a hardened argv,
	 * the approval callback adopts it, and the executor must run that
	 * argv — never the raw model input.
	 *
	 * Hosts that do not need hardening (e.g. non-command tools) should
	 * leave this undefined; the runtime will use the original input.
	 */
	executionPlan?: CommandExecutionPlan;
}

/**
 * Command execution envelope produced by the canonical command policy
 * (CORRECTION04). Provenance is retained so the executor can defensively
 * verify that the plan agrees with the evaluated decisions.
 */
export interface CommandExecutionPlan {
	/**
	 * The hardened input that the executor must use. For run_commands
	 * (and any other command-shaped tool) this is the same shape as the
	 * original tool input, but with `command` / `commands` rewritten
	 * under the per-command SafeExecutionProfile.
	 */
	transformedInput: unknown;
	/**
	 * Per-command provenance. Indexes align with the original normalized
	 * command list. This is for telemetry / audit / debugging — the
	 * executor MUST use `transformedInput` for execution, not the
	 * entries here.
	 */
	commands: ReadonlyArray<CommandExecutionPlanEntry>;
}

export interface CommandExecutionPlanEntry {
	commandIndex: number;
	/**
	 * The hardened command that will be executed. For a string command
	 * this is the rewritten string; for a structured command this is
	 * the rewritten `{command, args}` object.
	 */
	hardenedCommand: string | Record<string, unknown>;
	/**
	 * The source rule that matched this command (e.g. "host_safe_pwd"),
	 * or undefined if the command was not matched by any safe rule.
	 */
	matchedRuleSource?: string;
	/**
	 * The SafeExecutionProfile source applied to this command (e.g.
	 * "host_safe_git_diff_profile"), or undefined if no profile was
	 * applied.
	 */
	profileSource?: string;
	/**
	 * ACT-CLINEMM-RUN-COMMAND-PER-COMMAND-AUTHORITY-BINDING01:
	 *
	 * Optional per-command authority slot stamped by the host's
	 * authorization callback. The capability travels with the
	 * authorization entry that granted it (NOT a parallel array; NOT
	 * a text match). When the runtime+executor correlate the plan
	 * against the actual executable commands, the executor consumes
	 * entry.executionCapability as the EXACT authority for command
	 * `commandIndex`.
	 *
	 * Provenance boundary (same trust model as
	 * `ToolApprovalResult.executionCapability`):
	 *   TRUSTED SOURCE: host's policy callback result for THIS entry.
	 *   UNTRUSTED: model-stream metadata, MCP, webview, gRPC.
	 *
	 * `InternalExecutionCapability` is a closed union with literal
	 * `kind` discriminator; widening requires editing
	 * `InternalExecutionCapability` itself (not metadata).
	 *
	 * Once a valid per-command plan exists, the executor MUST use
	 * `entry.executionCapability` (or undefined) and MUST NOT fall
	 * back to the tool-call `AgentToolContext.executionCapability`.
	 * A missing entry means a missing capability; silent broadening
	 * of authority is forbidden (binding-design.md FAIL-CLOSED).
	 */
	executionCapability?: InternalExecutionCapability;
}

export const ToolCallRecordSchema = z.object({
	id: z.string(),
	name: z.string(),
	execution: z.enum(["client", "provider"]).optional(),
	input: z.unknown(),
	output: z.unknown(),
	error: z.string().optional(),
	durationMs: z.number(),
	startedAt: z.date(),
	endedAt: z.date(),
});
