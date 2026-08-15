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

export interface ToolApprovalResult {
	approved: boolean;
	reason?: string;
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
